import {expect, test, type Page} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {products} from '../../src/lib/catalog';

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
  if (
    process.env.UPDATE_SCREENSHOTS === '1' &&
    test.info().project.name === 'chromium'
  ) {
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

test.beforeEach(async ({context}, testInfo) => {
  // The isolated loopback server alone trusts this test header. Every case gets
  // a separate visitor allowance; rate-limit enforcement is covered by API tests.
  const hash = createHash('sha256').update(testInfo.testId).digest();
  await context.setExtraHTTPHeaders({
    'x-forwarded-for': `${hash[0] % 2 ? '192.0.2' : '198.51.100'}.${(hash[1] % 254) + 1}`,
  });
});

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
  await page.keyboard.press('Enter');
  await expect(detail).toBeVisible();
  await detail.getByRole('button', {name: 'Close Hush 75'}).click();
  await expect(detail).toHaveCount(0);
  await expect(productButton).toBeFocused();
  await page.getByRole('button', {name: 'Everything', exact: true}).click();
  await expect(collectionCards(page)).toHaveCount(18);
});

test('Chromium renders real WebGL and rotation changes the canvas', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'WebGL rendering proof is measured in Chromium; static fallback is checked in every browser.',
  );
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
  await expect(page.locator('.toast[role="status"]')).toContainText(
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
  await expect(page.locator('.toast[role="status"]')).toContainText(
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
    await expect(
      navigation.getByRole('link', {name: 'The collection'}),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(navigation).toBeHidden();
    await expect(
      page.getByRole('button', {name: 'Toggle navigation'}),
    ).toBeFocused();
    await page.getByRole('button', {name: 'Toggle navigation'}).click();
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
      await expect(page.locator('[data-preview]')).toHaveAttribute(
        'data-preview',
        'static',
      );
      const restore3D = page.getByRole('button', {name: 'Show 3D workspace'});
      await expect(restore3D).toBeVisible();
      await restore3D.click();
      await expect(page.locator('[data-preview]')).toHaveAttribute(
        'data-preview',
        'interactive',
      );
      await page
        .getByRole('button', {name: 'Show static workspace illustration'})
        .click();
      await expect(page.locator('[data-preview]')).toHaveAttribute(
        'data-preview',
        'static',
      );
      await expect(restore3D).toBeVisible();
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

test('catalog retry preserves the shared setup and saved bag through an outage', async ({
  page,
}) => {
  await page.goto('/builder');
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  await page.locator('.product-choice').filter({hasText: 'Form Desk'}).click();
  await page.getByRole('button', {name: 'Add setup to bag'}).click();
  const savedCount = await bag(page)
    .getByRole('heading', {level: 2, name: /^Your bag/})
    .textContent();
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Share this workspace'}).click();
  const sharedUrl = await page
    .getByLabel('Share your workspace', {exact: true})
    .inputValue();
  let unavailable = true;
  await page.route('**/api/catalog', async (route) => {
    if (unavailable) {
      await route.fulfill({status: 503, json: {error: 'Catalog offline'}});
    } else {
      await route.continue();
    }
  });
  await page.goto(sharedUrl);
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Your bag and setup are kept',
  );
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeDisabled();
  const choice = page.locator('.product-choice').filter({hasText: 'Form Desk'});
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: /^Open bag/}).click();
  await expect(
    bag(page).getByRole('heading', {level: 2, name: /^Your bag/}),
  ).toHaveText(savedCount!);
  await expect(bag(page).getByText('Form Desk', {exact: true})).toBeVisible();
  await expect(
    bag(page).getByRole('button', {name: 'Checkout not connected'}),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  unavailable = false;
  await page.getByRole('button', {name: 'Retry catalog', exact: true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: /^Open bag/}).click();
  await expect(
    bag(page).getByRole('heading', {level: 2, name: /^Your bag/}),
  ).toHaveText(savedCount!);
});

test('a stalled catalog request reaches a bounded timeout and can recover', async ({
  page,
}) => {
  await page.clock.install();
  let stalled = true;
  await page.route('**/api/catalog', async (route) => {
    if (!stalled) await route.continue();
    // Deliberately leave the first request pending until the client aborts it.
  });
  const firstRequest = page.waitForRequest('**/api/catalog');
  await page.goto('/builder', {waitUntil: 'domcontentloaded'});
  await firstRequest;
  await expect(
    page.getByText('Checking the current catalog. Preview prices are loading.'),
  ).toBeVisible();
  await page.clock.fastForward(15001);
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'The catalog took too long to respond.',
  );
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeDisabled();
  stalled = false;
  await page.getByRole('button', {name: 'Retry catalog', exact: true}).click();
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
});

async function mockConnectedCatalog(page: Page) {
  await page.route('**/api/catalog', (route) =>
    route.fulfill({json: {products, source: 'shopify', checkoutEnabled: true}}),
  );
}

test('checkout ignores rapid duplicate submits, permits the server deadline and recovers from failure', async ({
  page,
}) => {
  await page.clock.install();
  await mockConnectedCatalog(page);
  let requests = 0;
  let release!: () => void;
  const pendingResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/checkout', async (route) => {
    requests++;
    await pendingResponse;
    await route.fulfill({
      status: 503,
      json: {error: 'Test checkout is temporarily unavailable.'},
    });
  });
  await page.goto('/shop');
  await page
    .getByRole('button', {name: 'Add Arc Desk to bag', exact: true})
    .click();
  const checkout = bag(page).getByRole('button', {
    name: 'Continue to test checkout',
  });
  await expect(checkout).toBeEnabled();
  await checkout.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => requests).toBe(1);
  await page.clock.fastForward(25000);
  await expect(
    bag(page).getByRole('button', {name: 'Opening secure checkout…'}),
  ).toBeDisabled();
  await expect(
    bag(page).getByRole('button', {name: 'Increase Arc Desk quantity'}),
  ).toBeDisabled();
  release();
  await expect(bag(page).getByRole('alert')).toHaveText(
    'Test checkout is temporarily unavailable.',
  );
  await expect(checkout).toBeEnabled();
  await checkout.click();
  await expect.poll(() => requests).toBe(2);
  await expect(
    bag(page).getByRole('heading', {level: 2, name: /^Your bag/}),
  ).toHaveText('Your bag (1)');
});

test('checkout handoff and browser Back preserve the bag without claiming an order completed', async ({
  page,
}) => {
  await mockConnectedCatalog(page);
  await page.route('**/api/checkout', (route) =>
    route.fulfill({
      json: {checkoutUrl: 'https://checkout.shopify.test/test-checkout'},
    }),
  );
  // This locally fulfilled destination tests navigation only. No Shopify request or payment occurs.
  await page.route('https://checkout.shopify.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Mock Shopify test checkout</h1>',
    }),
  );
  await page.goto('/shop');
  await page
    .getByRole('button', {name: 'Add Arc Desk to bag', exact: true})
    .click();
  await expect(
    bag(page).getByText('Test payments only. No physical fulfillment.'),
  ).toBeVisible();
  await bag(page)
    .getByRole('button', {name: 'Continue to test checkout'})
    .click();
  await expect(page).toHaveURL('https://checkout.shopify.test/test-checkout');
  await page.goBack();
  await expect(bag(page)).toBeVisible();
  await expect(bag(page).getByRole('status')).toContainText(
    'DeskLab cannot confirm whether your Shopify order was completed.',
  );
  await expect(
    bag(page).getByRole('heading', {level: 2, name: /^Your bag/}),
  ).toHaveText('Your bag (1)');
  await expect(
    bag(page).getByRole('button', {name: 'Continue to test checkout'}),
  ).toBeEnabled();
  await bag(page).getByRole('button', {name: 'Clear bag', exact: true}).click();
  await expect(
    bag(page).getByRole('heading', {level: 2, name: /^Your bag/}),
  ).toHaveText('Your bag (0)');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(
    page.getByRole('button', {name: 'Open bag, 0 items'}),
  ).toBeVisible();
});

test('reduced motion starts with a useful static preview and keyboard controls retain focus', async ({
  page,
}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/builder');
  await expect(
    page.getByRole('button', {name: 'Build my workspace'}),
  ).toBeEnabled();
  await expect(page.locator('[data-preview]')).toHaveAttribute(
    'data-preview',
    'static',
  );
  await expect(page.locator('[data-preview] canvas')).toHaveCount(0);
  await expect(
    page.getByRole('button', {name: 'Rotate workspace right'}),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', {name: 'Show 3D workspace'}),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).toBe('auto');
  const build = page.getByRole('button', {name: 'Build my workspace'});
  expect(
    await build.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe('0s');
  await page.getByRole('link', {name: 'Skip to content'}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const add = page.getByRole('button', {name: 'Add setup to bag'});
  await add.focus();
  await page.keyboard.press('Enter');
  const close = bag(page).getByRole('button', {name: /^Close Your bag/});
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    bag(page).getByRole('button', {name: 'A little more exploring'}),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(bag(page)).toHaveCount(0);
  await expect(add).toBeFocused();
});
