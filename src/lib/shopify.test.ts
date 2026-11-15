import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {products} from './catalog';
import {
  CommerceError,
  createCheckout,
  getCatalog,
  moneyToCents,
  validateCartLines,
} from './shopify';
import {POST as checkoutRoute} from '../app/api/checkout/route';

function environment(t: TestContext, configured = true) {
  const before = {...process.env};
  if (configured) {
    process.env.SHOPIFY_STORE_DOMAIN = 'desklab-test.myshopify.com';
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN = 'public-test-token';
    process.env.SHOPIFY_TEST_CHECKOUT_ENABLED = 'true';
  } else {
    delete process.env.SHOPIFY_STORE_DOMAIN;
    delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
    delete process.env.SHOPIFY_TEST_CHECKOUT_ENABLED;
  }
  t.after(() => {
    process.env = before;
  });
}

const variantId = 'gid://shopify/ProductVariant/123';
function liveData(quantity = 20) {
  return {
    p0: {
      handle: products[0].handle,
      title: products[0].name,
      description: products[0].description,
      variants: {
        nodes: [
          {
            id: variantId,
            availableForSale: quantity > 0,
            quantityAvailable: quantity,
            price: {amount: '123.45', currencyCode: 'CAD'},
          },
        ],
      },
    },
  };
}

test('money conversion is exact and rejects foreign currencies or malformed prices', () => {
  assert.equal(moneyToCents('123.45', 'CAD'), 12345);
  assert.equal(moneyToCents('123.4', 'CAD'), 12340);
  for (const [amount, currency] of [
    ['1.234', 'CAD'],
    ['-1', 'CAD'],
    ['12', 'USD'],
    ['NaN', 'CAD'],
  ]) {
    assert.throws(() => moneyToCents(amount, currency), CommerceError);
  }
});

test('checkout rejects unknown IDs, duplicates, client-supplied prices and invalid quantities', () => {
  for (const input of [
    [],
    [{productId: 'unknown', quantity: 1}],
    [{productId: products[0].id, quantity: 0}],
    [{productId: products[0].id, quantity: 1, priceCents: 1}],
    [
      {productId: products[0].id, quantity: 1},
      {productId: products[0].id, quantity: 1},
    ],
  ]) {
    assert.throws(() => validateCartLines(input), CommerceError);
  }
});

test('unconfigured catalog is explicitly demo and checkout stays unavailable', async (t) => {
  environment(t, false);
  const catalog = await getCatalog();
  assert.equal(catalog.source, 'demo');
  assert.equal(catalog.checkoutEnabled, false);
  await assert.rejects(
    createCheckout([{productId: products[0].id, quantity: 1}]),
    (error: unknown) => error instanceof CommerceError && error.status === 503,
  );
});

test('live catalog uses live CAD prices and excludes unpublished products', async (t) => {
  environment(t);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({data: liveData()}),
  );
  const catalog = await getCatalog();
  assert.equal(catalog.source, 'shopify');
  assert.equal(catalog.products.length, 1);
  assert.equal(catalog.products[0].priceCents, 12345);
  assert.equal(catalog.products[0].shopifyVariantId, variantId);
});

test('upstream failure never silently falls back to fixture merchandise', async (t) => {
  environment(t);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {errors: [{message: 'private upstream details'}]},
      {status: 500},
    ),
  );
  await assert.rejects(
    getCatalog(),
    (error: unknown) =>
      error instanceof CommerceError &&
      !error.message.includes('private upstream'),
  );
});

test('Storefront credentials alone never enable checkout', async (t) => {
  environment(t);
  delete process.env.SHOPIFY_TEST_CHECKOUT_ENABLED;
  const network = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({data: liveData()}),
  );
  const catalog = await getCatalog();
  assert.equal(catalog.source, 'shopify');
  assert.equal(catalog.checkoutEnabled, false);
  const response = await checkoutRoute(
    new Request('https://desklab.example/api/checkout', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({lines: [{productId: products[0].id, quantity: 1}]}),
    }),
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Test checkout is not enabled/);
  assert.equal(network.mock.calls.length, 1);
});

test('checkout rechecks stock before creating a Shopify cart', async (t) => {
  environment(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({data: liveData(1)}),
  );
  await assert.rejects(
    createCheckout([{productId: products[0].id, quantity: 2}]),
    (error: unknown) => error instanceof CommerceError && error.status === 409,
  );
  assert.equal(fetchMock.mock.calls.length, 1);
});

test('checkout sends authoritative variant IDs and verifies returned line quantities', async (t) => {
  environment(t);
  const requests: {query: string; variables: Record<string, unknown>}[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      requests.push(request);
      if (!request.query.includes('mutation'))
        return Response.json({data: liveData()});
      return Response.json({
        data: {
          cartCreate: {
            cart: {
              checkoutUrl: 'https://desklab-test.myshopify.com/checkouts/test',
              totalQuantity: 2,
              lines: {nodes: [{quantity: 2, merchandise: {id: variantId}}]},
            },
            userErrors: [],
            warnings: [],
          },
        },
      });
    },
  );
  assert.equal(
    (await createCheckout([{productId: products[0].id, quantity: 2}]))
      .checkoutUrl,
    'https://desklab-test.myshopify.com/checkouts/test',
  );
  assert.deepEqual(requests[1].variables.input, {
    lines: [{merchandiseId: variantId, quantity: 2}],
    buyerIdentity: {countryCode: 'CA'},
  });
});

test('checkout refuses Shopify warnings instead of silently buying a reduced cart', async (t) => {
  environment(t);
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      return Response.json({
        data: request.query.includes('mutation')
          ? {
              cartCreate: {
                cart: null,
                userErrors: [],
                warnings: [
                  {
                    code: 'MERCHANDISE_NOT_ENOUGH_STOCK',
                    message: 'Stock changed',
                  },
                ],
              },
            }
          : liveData(),
      });
    },
  );
  await assert.rejects(
    createCheckout([{productId: products[0].id, quantity: 1}]),
    (error: unknown) => error instanceof CommerceError && error.status === 409,
  );
});

test('checkout endpoint rejects oversized and cross-origin bodies before commerce calls', async () => {
  const oversized = await checkoutRoute(
    new Request('https://desklab.example/api/checkout', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({lines: 'a'.repeat(9000)}),
    }),
  );
  assert.equal(oversized.status, 413);
  const crossOrigin = await checkoutRoute(
    new Request('https://desklab.example/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      body: '{}',
    }),
  );
  assert.equal(crossOrigin.status, 403);
});
