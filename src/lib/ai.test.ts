import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {
  DEFAULT_PREFERENCES,
  FREE_TIER_MODEL,
  interpretBrief,
  validatePreferences,
} from './ai';
import {POST as recommendRoute} from '../app/api/recommend/route';

function environment(t: TestContext, live = false) {
  const before = {...process.env};
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  process.env.ENABLE_LIVE_AI = live ? 'true' : 'false';
  process.env.GEMINI_FREE_TIER_CONFIRMED = live ? 'true' : 'false';
  process.env.GEMINI_MODEL = FREE_TIER_MODEL;
  process.env.GEMINI_API_KEY = 'test-model-key';
  process.env.UPSTASH_REDIS_REST_URL = 'https://desklab-test.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';
  process.env.APP_ORIGIN = 'https://desklab.example';
  process.env.RATE_LIMIT_BACKEND = 'redis';
  process.env.RATE_LIMIT_IP_HASH_SECRET = 'test-rate-limit-salt-32-characters';
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

test('live AI requires explicit free-project confirmation and the reviewed model', async (t) => {
  for (const values of [
    {GEMINI_FREE_TIER_CONFIRMED: 'false'},
    {GEMINI_FREE_TIER_CONFIRMED: ''},
    {GEMINI_MODEL: 'gemini-4-carbon'},
    {GEMINI_MODEL: 'gemini-3.5-flash-lite-latest'},
    {GEMINI_API_KEY: ''},
  ]) {
    await t.test(JSON.stringify(Object.keys(values)), async (child) => {
      environment(child, true);
      Object.assign(process.env, values);
      const network = child.mock.method(globalThis, 'fetch', async () => {
        throw new Error('Unexpected network call');
      });
      const result = await interpretBrief('Under $750', DEFAULT_PREFERENCES);
      assert.equal(result.engine, 'rules');
      assert.equal(result.preferences.budgetCents, 75000);
      assert.equal(network.mock.calls.length, 0);
    });
  }
});

test('an empty brief preserves selected preferences without using an allowance', async (t) => {
  environment(t, true);
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call');
  });
  const result = await interpretBrief('   ', DEFAULT_PREFERENCES);
  assert.equal(result.engine, 'rules');
  assert.deepEqual(result.preferences, DEFAULT_PREFERENCES);
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

test('missing, invalid, or failed shared allowance never calls the provider', async (t) => {
  for (const scenario of ['missing', 'foreign-host', 'error', 'timeout']) {
    await t.test(scenario, async (child) => {
      environment(child, true);
      if (scenario === 'missing') delete process.env.UPSTASH_REDIS_REST_TOKEN;
      if (scenario === 'foreign-host')
        process.env.UPSTASH_REDIS_REST_URL = 'https://example.com';
      const network = child.mock.method(globalThis, 'fetch', async () => {
        if (scenario === 'timeout')
          throw new DOMException('Timeout', 'TimeoutError');
        return Response.json({error: 'unavailable'}, {status: 503});
      });
      const result = await interpretBrief('Under $750', DEFAULT_PREFERENCES);
      assert.equal(result.engine, 'rules');
      assert.equal(
        network.mock.calls.length,
        ['missing', 'foreign-host'].includes(scenario) ? 0 : 1,
      );
      assert.ok(
        network.mock.calls.every((call) =>
          String(call.arguments[0]).includes('upstash'),
        ),
      );
    });
  }
});

test('AI accepts validated preferences only and discards any model-selected merchandise', async (t) => {
  environment(t, true);
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push(String(init.body));
    if (url.includes('upstash')) return Response.json({result: 1});
    assert.equal(
      url,
      `https://generativelanguage.googleapis.com/v1beta/models/${FREE_TIER_MODEL}:generateContent`,
    );
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal);
    const body = JSON.parse(String(init.body));
    assert.equal(body.generationConfig.maxOutputTokens, 512);
    assert.equal(body.generationConfig.candidateCount, 1);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(
      body.generationConfig.responseJsonSchema.additionalProperties,
      false,
    );
    assert.equal(body.tools, undefined);
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

test('quota errors, outages, and timeouts fall back once with no alternate model', async (t) => {
  for (const failure of [429, 500, 'timeout'] as const) {
    await t.test(String(failure), async (child) => {
      environment(child, true);
      const network = child.mock.method(
        globalThis,
        'fetch',
        async (url: string) => {
          if (url.includes('upstash')) return Response.json({result: 1});
          if (failure === 'timeout')
            throw new DOMException('Timeout', 'TimeoutError');
          return Response.json(
            {error: {message: 'Do not expose provider details'}},
            {status: failure},
          );
        },
      );
      const result = await interpretBrief(
        'Warm under $900',
        DEFAULT_PREFERENCES,
      );
      assert.equal(result.engine, 'rules');
      assert.equal(result.preferences.budgetCents, 90000);
      assert.equal(network.mock.calls.length, 2);
      assert.equal(JSON.stringify(result).includes('provider details'), false);
    });
  }
});

test('blocked, malformed, or truncated provider responses never masquerade as AI success', async (t) => {
  for (const response of [
    {},
    {candidates: [{finishReason: 'SAFETY'}]},
    {
      candidates: [
        {
          finishReason: 'MAX_TOKENS',
          content: {parts: [{text: JSON.stringify(DEFAULT_PREFERENCES)}]},
        },
      ],
    },
    {
      candidates: [
        {finishReason: 'STOP', content: {parts: [{text: 'not json'}]}},
      ],
    },
    {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [{text: JSON.stringify(DEFAULT_PREFERENCES), thought: true}],
          },
        },
      ],
    },
    {
      candidates: [
        {finishReason: 'STOP', content: {parts: [{text: 'x'.repeat(2001)}]}},
      ],
    },
  ]) {
    await t.test('provider response rejected', async (child) => {
      environment(child, true);
      const network = child.mock.method(
        globalThis,
        'fetch',
        async (url: string) =>
          Response.json(url.includes('upstash') ? {result: 1} : response),
      );
      const result = await interpretBrief(
        'Warm under $900',
        DEFAULT_PREFERENCES,
      );
      assert.equal(result.engine, 'rules');
      assert.equal(network.mock.calls.length, 2);
    });
  }
});

test('invalid fallback values preserve validated selections and explain the limit', async (t) => {
  environment(t);
  for (const brief of ['Under $100,000', 'A 20 cm desk', 'Budget $0']) {
    const result = await interpretBrief(brief, DEFAULT_PREFERENCES);
    assert.deepEqual(result.preferences, DEFAULT_PREFERENCES);
    assert.ok(
      result.notices.some((notice) =>
        notice.includes('outside the supported limits'),
      ),
    );
  }
  await assert.rejects(interpretBrief('x'.repeat(1001), DEFAULT_PREFERENCES));
  await assert.rejects(
    interpretBrief('A desk', {...DEFAULT_PREFERENCES, budgetCents: -1}),
  );
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
  const network = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({result: [1, 0]}),
  );
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
  assert.equal(network.mock.calls.length, 1);
  assert.match(String(network.mock.calls[0].arguments[0]), /upstash/);
});

test('request allowance rejection happens before any live AI request', async (t) => {
  environment(t, true);
  const network = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({result: [0, 30]}),
  );
  const response = await recommendRoute(
    new Request('https://desklab.example/api/recommend', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        brief: 'A warm setup under $750',
        preferences: DEFAULT_PREFERENCES,
      }),
    }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '30');
  assert.equal(network.mock.calls.length, 1);
  assert.match(String(network.mock.calls[0].arguments[0]), /upstash/);
});
