import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {DEFAULT_PREFERENCES, interpretBrief, validatePreferences} from './ai';
import {POST as recommendRoute} from '../app/api/recommend/route';

function environment(t: TestContext, live = false) {
  const before = {...process.env};
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  process.env.ENABLE_LIVE_AI = live ? 'true' : 'false';
  process.env.GEMINI_API_KEY = 'test-model-key';
  process.env.UPSTASH_REDIS_REST_URL = 'https://desklab-test.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';
  t.after(() => {
    process.env = before;
  });
}

test('a model key alone never triggers paid requests', async (t) => {
  environment(t);
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call');
  });
  const result = await interpretBrief(
    'Quiet warm desk under $750',
    DEFAULT_PREFERENCES,
  );
  assert.equal(result.engine, 'rules');
  assert.equal(result.preferences.budgetCents, 75000);
  assert.equal(network.mock.calls.length, 0);
});

test('exhausted distributed allowance falls back without calling Gemini', async (t) => {
  environment(t, true);
  const network = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({result: 0}),
  );
  const result = await interpretBrief(
    'Minimal desk under $800',
    DEFAULT_PREFERENCES,
  );
  assert.equal(result.engine, 'rules');
  assert.equal(network.mock.calls.length, 1);
  assert.match(String(network.mock.calls[0].arguments[0]), /upstash/);
});

test('AI accepts validated preferences only and discards any model-selected merchandise', async (t) => {
  environment(t, true);
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push(String(init.body));
    if (url.includes('upstash')) return Response.json({result: 1});
    return Response.json({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              {
                text: JSON.stringify({
                  budgetCents: 60000,
                  deskWidthCm: 120,
                  style: 'minimal',
                  quiet: false,
                  products: [{id: 'invented-product', priceCents: 1}],
                }),
              },
            ],
          },
        },
      ],
    });
  });
  const result = await interpretBrief(
    'Minimal clicky setup under $600',
    DEFAULT_PREFERENCES,
  );
  assert.equal(result.engine, 'gemini');
  assert.deepEqual(result.preferences, {
    budgetCents: 60000,
    deskWidthCm: 120,
    style: 'minimal',
    quiet: false,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].includes('Minimal clicky setup'), false);
});

test('invalid or incomplete model output falls back without paid retries', async (t) => {
  environment(t, true);
  const network = t.mock.method(globalThis, 'fetch', async (url: string) =>
    url.includes('upstash')
      ? Response.json({result: 1})
      : Response.json({
          candidates: [
            {
              finishReason: 'STOP',
              content: {parts: [{text: '{"budgetCents":-1}'}]},
            },
          ],
        }),
  );
  const result = await interpretBrief(
    'Warm setup under $900',
    DEFAULT_PREFERENCES,
  );
  assert.equal(result.engine, 'rules');
  assert.equal(result.preferences.budgetCents, 90000);
  assert.equal(network.mock.calls.length, 2);
});

test('preferences reject non-finite values and unsupported styles', () => {
  assert.throws(() =>
    validatePreferences({...DEFAULT_PREFERENCES, budgetCents: Infinity}),
  );
  assert.throws(() =>
    validatePreferences({...DEFAULT_PREFERENCES, style: 'anything'}),
  );
  assert.throws(() =>
    validatePreferences({...DEFAULT_PREFERENCES, deskWidthCm: 0}),
  );
});

test('recommendation endpoint reports its engine and never exceeds requested budget', async (t) => {
  environment(t);
  const response = await recommendRoute(
    new Request('https://desklab.example/api/recommend', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        brief: 'Warm quiet setup under $750',
        preferences: DEFAULT_PREFERENCES,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.engine, 'rules');
  assert.equal(result.catalogSource, 'demo');
  assert.equal(result.checkoutEnabled, false);
  assert.ok(result.catalogSnapshot.length > 0);
  assert.ok(
    result.products.every((product: {id: string; priceCents: number}) =>
      result.catalogSnapshot.some(
        (item: {id: string; priceCents: number}) =>
          item.id === product.id && item.priceCents === product.priceCents,
      ),
    ),
  );
  assert.ok(result.totalCents <= 75000);
  assert.ok(result.notices.length > 0);
});
