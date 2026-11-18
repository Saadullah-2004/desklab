import {expect, test, type Page, type Route} from '@playwright/test';
import {products} from '../../src/lib/catalog';
import {encodeConfiguration} from '../../src/lib/configuration';
import {recommendSetup} from '../../src/lib/recommend';
import type {Preferences} from '../../src/lib/types';

const defaults: Preferences = {
  budgetCents: 65000,
  deskWidthCm: 140,
  style: 'warm',
  quiet: true,
};

function response(preferences = defaults) {
  return {
    ...recommendSetup(preferences),
    engine: 'rules',
    notices: [],
    catalogSnapshot: products,
    catalogSource: 'demo',
    checkoutEnabled: false,
  };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {promise, release};
}

async function settleResponse(page: Page, gate: ReturnType<typeof deferred>) {
  const completed = page.waitForEvent('requestfinished', {
    predicate: (request) => request.url().endsWith('/api/recommend'),
  });
  gate.release();
  await completed;
  // Let response JSON and the resulting React render finish before asserting
  // that the old response did not replace an already-visible user edit.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test.beforeEach(async ({page}) => {
  // Deliberately ignore transport cancellation to prove the request revision
  // check also protects against a late response already being decoded.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let aborted = 0;
    window.fetch = (input, init) => {
      if (input === '/api/recommend') {
        init?.signal?.addEventListener('abort', () => {
          document.documentElement.dataset.abortedRecommendations = String(
            ++aborted,
          );
        });
        const options = {...init};
        delete options.signal;
        return originalFetch(input, options);
      }
      return originalFetch(input, init);
    };
  });
  await page.route('**/api/catalog', (route) =>
    route.fulfill({json: {products, source: 'demo', checkoutEnabled: false}}),
  );
});

const edits = [
  {
    name: 'budget',
    apply: async (page: Page) => {
      const budget = page.getByRole('slider', {name: 'Your budget'});
      await budget.press('ArrowRight');
      await budget.press('ArrowRight');
    },
    verify: async (page: Page) => {
      await expect(page.getByRole('slider', {name: 'Your budget'})).toHaveValue(
        '70000',
      );
    },
  },
  {
    name: 'desk width',
    apply: async (page: Page) => {
      await page
        .getByRole('combobox', {name: 'Available desk width'})
        .selectOption('160');
    },
    verify: async (page: Page) => {
      await expect(
        page.getByRole('combobox', {name: 'Available desk width'}),
      ).toHaveValue('160');
    },
  },
  {
    name: 'palette',
    apply: async (page: Page) => {
      await page.getByRole('button', {name: 'Minimal', exact: true}).click();
    },
    verify: async (page: Page) => {
      await expect(
        page.getByRole('button', {name: 'Minimal', exact: true}),
      ).toHaveAttribute('aria-pressed', 'true');
    },
  },
  {
    name: 'quiet preference',
    apply: async (page: Page) => {
      await page
        .getByRole('checkbox', {name: 'Keep the keyboard quiet'})
        .uncheck();
    },
    verify: async (page: Page) => {
      await expect(
        page.getByRole('checkbox', {name: 'Keep the keyboard quiet'}),
      ).not.toBeChecked();
    },
  },
  {
    name: 'manual product choice',
    apply: async (page: Page) => {
      await page
        .locator('.product-choice')
        .filter({has: page.getByText('Form Desk', {exact: true})})
        .click();
    },
    verify: async (page: Page) => {
      await expect(
        page
          .locator('.product-choice')
          .filter({has: page.getByText('Form Desk', {exact: true})}),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.build-summary strong').first()).toContainText(
        '$490',
      );
    },
  },
];

for (const edit of edits)
  test(`a new ${edit.name} survives a delayed recommendation`, async ({
    page,
  }) => {
    const gate = deferred();
    await page.route('**/api/recommend', async (route) => {
      await gate.promise;
      await route.fulfill({
        json: {
          ...response(),
          engine: 'gemini',
          notices: ['Outdated interpretation notice.'],
        },
      });
    });
    await page.goto('/builder');
    const build = page.getByRole('button', {name: 'Build my workspace'});
    await expect(build).toBeEnabled();
    const requested = page.waitForRequest('**/api/recommend');
    await build.click();
    await requested;
    await expect(
      page.getByRole('button', {name: 'Finding your fit…'}),
    ).toBeDisabled();

    await edit.apply(page);
    await edit.verify(page);
    await expect(build).toBeEnabled();
    await settleResponse(page, gate);

    await edit.verify(page);
    await expect(page.getByText('Outdated interpretation notice.')).toHaveCount(
      0,
    );
    await expect(
      page.getByText(
        'AI interprets your brief. Verified rules check every fit.',
      ),
    ).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  });

test('leaving the builder aborts its pending recommendation', async ({
  page,
}) => {
  const gate = deferred();
  await page.route('**/api/recommend', async (route) => {
    await gate.promise;
    await route.fulfill({
      status: 503,
      json: {error: 'This builder is no longer open.'},
    });
  });
  await page.goto('/builder');
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  const request = page.waitForRequest('**/api/recommend');
  await page.getByRole('button', {name: 'Build my workspace'}).click();
  await request;
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('link', {name: 'The collection', exact: true})
    .click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.locator('html')).toHaveAttribute(
    'data-aborted-recommendations',
    '1',
  );
  await settleResponse(page, gate);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('editing only the brief allows a fresh build and stale errors cannot clear its loading state', async ({
  page,
}) => {
  const stale = deferred();
  const current = deferred();
  const routes: Route[] = [];
  await page.route('**/api/recommend', async (route) => {
    routes.push(route);
    if (routes.length === 1) {
      await stale.promise;
      await route.fulfill({
        status: 503,
        json: {error: 'This error belongs to the old brief.'},
      });
    } else {
      await current.promise;
      await route.fulfill({
        json: response({
          ...defaults,
          style: 'minimal',
          budgetCents: 50000,
          deskWidthCm: 120,
        }),
      });
    }
  });
  await page.goto('/builder');
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  const firstRequest = page.waitForRequest('**/api/recommend');
  await page.getByRole('button', {name: 'Build my workspace'}).click();
  await firstRequest;
  await page
    .getByLabel('What does a good workday look like?')
    .fill('A minimal setup under $500 for 120 cm.');
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  const secondRequest = page.waitForRequest('**/api/recommend');
  await page.getByRole('button', {name: 'Build my workspace'}).click();
  await secondRequest;
  await settleResponse(page, stale);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', {name: 'Finding your fit…'}),
  ).toBeDisabled();
  await settleResponse(page, current);
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  await expect(page.getByRole('slider', {name: 'Your budget'})).toHaveValue(
    '50000',
  );
  await expect(
    page.getByRole('button', {name: 'Minimal', exact: true}),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('setup explanation is keyboard accessible and follows manual edits and shared preferences', async ({
  page,
}) => {
  const chosen = products.filter((product) =>
    ['desk-form-chalk', 'keyboard-hush-chalk', 'light-column-chalk'].includes(
      product.id,
    ),
  );
  expect(chosen).toHaveLength(3);
  const encoded = encodeConfiguration(
    chosen.map((product) => ({productId: product.id, quantity: 1})),
    {...defaults, style: 'minimal', budgetCents: 50000, deskWidthCm: 120},
  );
  await page.goto('/builder?setup=' + encoded);
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  const explanation = page.locator('.setup-explanation');
  const summary = explanation.locator('summary');
  await expect(summary).toHaveText('Why this setup fits');
  await expect(explanation).not.toHaveAttribute('open', '');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(explanation).toHaveAttribute('open', '');
  await expect(explanation).toContainText(
    '$377 in products fits your $500 budget',
  );
  await expect(explanation).toContainText(
    '100 cm desk fits within your 120 cm space',
  );
  await expect(explanation).toContainText(
    '3 of 3 pieces match your minimal palette',
  );
  await expect(explanation).toContainText('optional shelf');
  await expect(explanation).toContainText('optional accessory');

  await page.getByRole('button', {name: 'Warm', exact: true}).click();
  await expect(explanation).toContainText(
    '0 of 3 pieces match your warm palette',
  );
  await expect(explanation).toContainText(
    'mixes finishes outside your preferred palette',
  );
  await page.getByRole('button', {name: 'Keyboards', exact: true}).click();
  await page
    .locator('.product-choice')
    .filter({has: page.getByText('Relay TKL', {exact: true})})
    .click();
  await expect(summary).toHaveText('Review this setup');
  await expect(explanation).toContainText(
    'Choose a quiet keyboard to match your preference.',
  );
  await expect(explanation).not.toContainText('keyboard is marked quiet');
  await page.getByRole('checkbox', {name: 'Keep the keyboard quiet'}).uncheck();
  await expect(summary).toHaveText('Why this setup fits');
  await expect(explanation).not.toContainText('keyboard is marked quiet');
  await expect(explanation).toContainText(
    '$397 in products fits your $500 budget',
  );
  await page.getByRole('slider', {name: 'Your budget'}).press('Home');
  await expect(summary).toHaveText('Review this setup');
  await expect(explanation).toContainText('Your selection is over budget.');
  await expect(explanation).not.toContainText('in products fits');
  await summary.focus();
  await page.keyboard.press('Space');
  await expect(explanation).not.toHaveAttribute('open', '');
});
