import {expect, test, type Page} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';

async function capturePortfolio(
  page: Page,
  artifactName: string,
  documentationName: string,
) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const screenshot = await page.screenshot({
    path: 'artifacts/' + artifactName,
    fullPage: true,
    animations: 'disabled',
  });
  // Explicitly requested captures only: routine test runs don't modify tracked documentation.
  if (process.env.UPDATE_SCREENSHOTS === '1') {
    await mkdir('docs/screenshots', {recursive: true});
    await writeFile('docs/screenshots/' + documentationName, screenshot);
  }
}

async function expectChoiceContentsToFit(page: Page) {
  const cards = page.locator('.product-choice');
  await expect(cards).not.toHaveCount(0);
  for (const card of await cards.all()) {
    for (const text of await card
      .locator(':scope > strong, :scope > span')
      .all()) {
      await expect(text).toBeVisible();
      const contained = await text.evaluate((element) => {
        const parent = element.closest('button')!;
        const outer = parent.getBoundingClientRect();
        const inner = element.getBoundingClientRect();
        return (
          inner.top >= outer.top - 1 &&
          inner.bottom <= outer.bottom + 1 &&
          inner.left >= outer.left - 1 &&
          inner.right <= outer.right + 1
        );
      });
      expect(
        contained,
        'Product names and prices must fit inside the selectable card',
      ).toBe(true);
    }
  }
}

function collectionCards(page: Page) {
  return page.locator('article.product-card');
}
function bag(page: Page) {
  return page.getByRole('dialog', {name: /^Your bag/});
}

test('home introduces the project and primary navigation reaches real routes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', {level: 1})).toHaveText(
    /Make room for\s*your best work\./,
  );
  await expect(
    page.getByText('Demo catalog · No physical fulfillment'),
  ).toBeVisible();
  await expect(page.locator('[data-preview]')).toHaveAttribute(
    'data-preview',
    /interactive|unavailable/,
  );
  await capturePortfolio(page, 'desklab-home-desktop.png', 'home-desktop.png');
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('link', {name: 'The collection'})
    .click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(collectionCards(page)).toHaveCount(18);
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('link', {name: 'Behind the build'})
    .click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(
    page.getByRole('link', {name: 'Explore the source'}),
  ).toHaveAttribute('href', 'https://github.com/Saadullah-2004/desklab');
  expect(errors).toEqual([]);
});

test('collection filtering, product details and Escape dismissal work', async ({
  page,
}) => {
  await page.goto('/shop');
  await page.getByRole('button', {name: 'Keyboards', exact: true}).click();
  await expect(collectionCards(page)).toHaveCount(4);
  await expect(
    collectionCards(page).getByText('Arc Desk', {exact: true}),
  ).toHaveCount(0);
  const productButton = page.getByRole('button', {
    name: 'View Hush 75',
    exact: true,
  });
  await productButton.click();
  const detail = page.getByRole('dialog', {name: 'Hush 75', exact: true});
  await expect(detail).toBeVisible();
  await expect(
    detail.getByText('Original demo product. No physical fulfillment.'),
  ).toBeVisible();
  await expect(
    detail.getByRole('button', {name: 'Add to bag', exact: true}),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(productButton).toBeFocused();
  await page.getByRole('button', {name: 'Everything', exact: true}).click();
  await expect(collectionCards(page)).toHaveCount(18);
});

test('normal Chrome renders real WebGL and rotation changes the canvas', async ({
  page,
}) => {
  await page.goto('/builder');
  const preview = page.locator('[data-preview]');
  await expect(preview).toHaveAttribute('data-preview', 'interactive');
  const canvas = preview.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole('button', {name: 'Rotate workspace right'}),
  ).toBeEnabled();
  const before = await canvas.screenshot();
  await page.getByRole('button', {name: 'Rotate workspace right'}).click();
  // Compare only rendered pixels, excluding the focused button and other HTML chrome.
  await expect
    .poll(async () => Buffer.compare(before, await canvas.screenshot()))
    .not.toBe(0);
  await page.getByRole('button', {name: 'Reset workspace view'}).click();
  await expectChoiceContentsToFit(page);
  await capturePortfolio(
    page,
    'desklab-builder-webgl.png',
    'workspace-builder.png',
  );
});

test('a real WebGL initialization failure offers an honest static preview', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (
        this: HTMLCanvasElement,
        contextId: string,
        ...args: unknown[]
      ) {
        if (
          contextId === 'webgl' ||
          contextId === 'webgl2' ||
          contextId === 'experimental-webgl'
        )
          return null;
        return Reflect.apply(original, this, [contextId, ...args]);
      },
    });
  });
  await page.goto('/builder');
  await expect(page.locator('[data-preview]')).toHaveAttribute(
    'data-preview',
    'unavailable',
  );
  await expect(
    page.getByText('Static preview · 3D is unavailable in this browser'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {name: 'Rotate workspace right'}),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', {name: '3D preview unavailable'}),
  ).toBeDisabled();
  await expect(page.locator('[data-preview] canvas')).toHaveCount(0);
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
});

test('bag quantities persist across reload, respect limits and can remove an item', async ({
  page,
}) => {
  await page.goto('/shop');
  await page
    .getByRole('button', {name: 'Add Arc Desk to bag', exact: true})
    .click();
  await expect(bag(page)).toBeVisible();
  await bag(page)
    .getByRole('button', {name: 'Increase Arc Desk quantity'})
    .click();
  await expect(
    bag(page).getByRole('heading', {name: 'Your bag (2)'}),
  ).toBeVisible();
  await expect(bag(page).getByText('$558 CAD', {exact: true})).toBeVisible();
  await bag(page).getByRole('button', {name: 'Close Your bag (2)'}).click();
  await page.reload();
  await page.getByRole('button', {name: 'Open bag, 2 items'}).click();
  await expect(
    bag(page).getByRole('heading', {name: 'Your bag (2)'}),
  ).toBeVisible();
  await expect(
    bag(page).getByRole('button', {name: 'Checkout not connected'}),
  ).toBeDisabled();
  await expect(
    bag(page).getByText('Explore freely. This is a demo.'),
  ).toBeVisible();
  for (let count = 2; count < 10; count++) {
    await bag(page)
      .getByRole('button', {name: 'Increase Arc Desk quantity'})
      .click();
  }
  await expect(
    bag(page).getByRole('heading', {name: 'Your bag (10)'}),
  ).toBeVisible();
  await expect(
    bag(page).getByRole('button', {name: 'Increase Arc Desk quantity'}),
  ).toBeDisabled();
  for (let count = 10; count > 0; count--) {
    await bag(page)
      .getByRole('button', {name: 'Decrease Arc Desk quantity'})
      .click();
  }
  await expect(
    bag(page).getByText(
      'Your bag is empty. Find a few things that feel like you.',
    ),
  ).toBeVisible();
  await bag(page).getByRole('button', {name: 'Close Your bag (0)'}).click();
  await page.reload();
  await expect(
    page.getByRole('button', {name: 'Open bag, 0 items'}),
  ).toBeVisible();
});

test('builder calls the real recommendation API, customizes and reloads a shared setup', async ({
  page,
}) => {
  await page.goto('/builder');
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  await page
    .getByLabel('What does a good workday look like?')
    .fill('A minimal and quiet setup under $500 for a 120 cm desk.');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/recommend') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', {name: 'Build my workspace'}).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.feasible).toBe(true);
  expect(result.preferences.budgetCents).toBe(50000);
  expect(result.preferences.deskWidthCm).toBe(120);
  expect(result.totalCents).toBeLessThanOrEqual(50000);
  expect(
    result.products.every((product: {available: boolean}) => product.available),
  ).toBe(true);
  await expect(
    page.getByRole('button', {name: 'Add setup to bag'}),
  ).toBeEnabled();
  await page.getByRole('button', {name: 'Keyboards', exact: true}).click();
  const hush = page
    .locator('.product-choice')
    .filter({has: page.getByText('Hush 75', {exact: true})});
  await hush.click();
  await expect(hush).toHaveClass(/selected/);
  await page.getByRole('button', {name: 'Share this workspace'}).click();
  const url = await page
    .getByLabel('Share your workspace', {exact: true})
    .inputValue();
  const parsed = new URL(url);
  expect(parsed.pathname).toBe('/builder');
  const encoded = parsed.searchParams.get('setup');
  expect(encoded).toBeTruthy();
  const setup = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'));
  expect(
    setup.lines.some(
      (line: {productId: string}) => line.productId === 'keyboard-hush-sand',
    ),
  ).toBe(true);
  await page.goto(url);
  await expect(page.getByRole('status')).toContainText(
    'Shared workspace loaded',
  );
  await page.getByRole('button', {name: 'Keyboards', exact: true}).click();
  await expect(
    page
      .locator('.product-choice')
      .filter({has: page.getByText('Hush 75', {exact: true})}),
  ).toHaveClass(/selected/);
  await page.getByRole('button', {name: 'Add setup to bag'}).click();
  await expect(bag(page).getByText('Hush 75', {exact: true})).toBeVisible();
});

test('an impossible budget gives an honest failure and disables adding a setup', async ({
  page,
}) => {
  await page.goto('/builder');
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  await page
    .getByLabel('What does a good workday look like?')
    .fill('A quiet complete setup under $250.');
  await page.getByRole('button', {name: 'Build my workspace'}).click();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('button', {name: 'Add setup to bag'}),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
});

test('builder preferences stay disabled until the catalog is ready', async ({
  page,
}) => {
  let releaseCatalog!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  await page.route('**/api/catalog', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/builder', {waitUntil: 'domcontentloaded'});
    await expect(
      page.getByLabel('What does a good workday look like?'),
    ).toBeDisabled();
    await expect(
      page.getByRole('slider', {name: 'Your budget'}),
    ).toBeDisabled();
    await expect(
      page.getByRole('combobox', {name: 'Available desk width'}),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', {name: 'Minimal', exact: true}),
    ).toBeDisabled();
    await expect(
      page.getByRole('checkbox', {name: 'Keep the keyboard quiet'}),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', {name: 'Build my workspace'}),
    ).toBeDisabled();
  } finally {
    releaseCatalog();
  }
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  await expect(
    page.getByLabel('What does a good workday look like?'),
  ).toBeEnabled();
});

test('invalid shared configurations are rejected without breaking the builder', async ({
  page,
}) => {
  const invalid = Buffer.from(
    JSON.stringify({
      v: 1,
      lines: [{productId: 'not-a-real-product', quantity: 1}],
    }),
  ).toString('base64url');
  await page.goto('/builder?setup=' + invalid);
  await expect(page.getByRole('status')).toContainText(
    'That shared workspace is invalid',
  );
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', {name: 'Add setup to bag'}),
  ).toBeEnabled();
  await expect(page.getByText('not-a-real-product')).toHaveCount(0);
});

test('a recommendation outage preserves the existing setup and allows retry', async ({
  page,
}) => {
  await page.goto('/builder');
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  await page.route('**/api/recommend', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Recommendations are temporarily unavailable.',
      }),
    });
  });
  await page.getByRole('button', {name: 'Build my workspace'}).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Recommendations are temporarily unavailable.',
  );
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', {name: 'Add setup to bag'}),
  ).toBeEnabled();
});

test.describe('mobile layout', () => {
  test.use({
    viewport: {width: 390, height: 844},
    isMobile: true,
    hasTouch: true,
  });
  test('navigation, storefront and builder remain usable without horizontal overflow', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('[data-preview]')).toHaveAttribute(
      'data-preview',
      /interactive|unavailable/,
    );
    await capturePortfolio(page, 'desklab-home-mobile.png', 'home-mobile.png');
    const navigation = page.getByRole('navigation', {name: 'Main navigation'});
    await expect(navigation).toBeHidden();
    await page.getByRole('button', {name: 'Toggle navigation'}).click();
    await expect(navigation).toBeVisible();
    await navigation.getByRole('link', {name: 'The collection'}).click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(
      page.getByRole('navigation', {name: 'Main navigation'}),
    ).toBeHidden();
    await expect(collectionCards(page)).toHaveCount(18);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole('button', {name: 'Toggle navigation'}).click();
    await page
      .getByRole('navigation', {name: 'Main navigation'})
      .getByRole('link', {name: /^Workspace studio/})
      .click();
    await expect(
      page.getByRole('button', {name: 'Build my workspace'}),
    ).toBeEnabled();
    await expect(page.locator('[data-preview]')).toHaveAttribute(
      'data-preview',
      /interactive|unavailable/,
    );
    await expectChoiceContentsToFit(page);
    if (
      await page
        .getByRole('button', {name: 'Show static workspace illustration'})
        .count()
    ) {
      await page
        .getByRole('button', {name: 'Show static workspace illustration'})
        .click();
      await expect(
        page.getByRole('button', {name: 'Show 3D workspace'}),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole('button', {name: '3D preview unavailable'}),
      ).toBeDisabled();
    }
    await expect(
      page.getByRole('button', {name: 'Rotate workspace left'}),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole('button', {name: 'Add setup to bag'}).click();
    await expect(bag(page)).toBeVisible();
    expect(
      await bag(page).evaluate(
        (element) => element.getBoundingClientRect().width <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
