import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {
  readJson,
  errorResponse,
  handleApiRequest,
  assertAllowedOrigin,
} from '../src/app/api/_utils';
import {CommerceError} from '../src/lib/shopify';
import {GET as catalogRoute} from '../src/app/api/catalog/route';
import {GET as healthRoute} from '../src/app/api/health/route';
import {POST as checkoutRoute} from '../src/app/api/checkout/route';
import nextConfig from '../next.config';

const url = 'https://desklab.example/api/checkout';

function environment(t: TestContext, values: Record<string, string> = {}) {
  const before = {...process.env};
  for (const key of [
    'APP_ORIGIN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'RATE_LIMIT_IP_HASH_SECRET',
    'RATE_LIMIT_CLIENT_IP_HEADER',
    'RATE_LIMIT_BACKEND',
    'VERCEL',
  ])
    delete process.env[key];
  process.env = {...process.env, NODE_ENV: 'test', ...values};
  t.after(() => {
    process.env = before;
  });
}

test('same-origin validation uses the browser Host when Next reconstructs a bind hostname', async () => {
  const request = new Request('http://localhost:3001/api/recommend', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: '127.0.0.1:3001',
      origin: 'http://127.0.0.1:3001',
    },
    body: '{}',
  });
  assert.deepEqual(await readJson(request), {});
});

test('JSON boundary accepts same-origin requests and rejects cross-origin posts', async () => {
  const request = (origin: string) =>
    new Request(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', origin},
      body: JSON.stringify({lines: []}),
    });
  assert.deepEqual(await readJson(request('https://desklab.example')), {
    lines: [],
  });
  await assert.rejects(
    readJson(request('https://unrelated.example')),
    (error: unknown) => error instanceof CommerceError && error.status === 403,
  );
});

test('body limit is enforced on streamed bytes without trusting Content-Length', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"brief":"'));
      controller.enqueue(new TextEncoder().encode('x'.repeat(8192)));
      controller.enqueue(new TextEncoder().encode('"}'));
      controller.close();
    },
  });
  const request = new Request(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'content-length': '1'},
    body,
    duplex: 'half',
  } as RequestInit);
  await assert.rejects(
    readJson(request),
    (error: unknown) => error instanceof CommerceError && error.status === 413,
  );
});

test('boundary rejects unsupported content types, malformed JSON and arrays', async () => {
  for (const [body, contentType, status] of [
    ['{}', 'text/plain', 415],
    ['{}', 'application/jsonp', 415],
    ['{"broken":', 'application/json', 400],
    ['[]', 'application/json', 400],
    ['null', 'application/json', 400],
  ] as const) {
    await assert.rejects(
      readJson(
        new Request(url, {
          method: 'POST',
          headers: {'content-type': contentType},
          body,
        }),
      ),
      (error: unknown) =>
        error instanceof CommerceError && error.status === status,
    );
  }
});

test('unexpected failures return a generic non-cacheable error without internal details', async () => {
  const response = errorResponse(new Error('secret provider response'));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(JSON.stringify(await response.json()).includes('secret'), false);
});

test('production origin validation uses canonical configuration, not spoofable host headers', (t) => {
  environment(t, {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://desklab.example',
  });
  assert.doesNotThrow(() =>
    assertAllowedOrigin(
      new Request('http://localhost:3000/api/checkout', {
        method: 'POST',
        headers: {
          origin: 'https://desklab.example',
          host: 'unrelated.example',
          'x-forwarded-host': 'unrelated.example',
        },
      }),
    ),
  );
  assert.throws(
    () =>
      assertAllowedOrigin(
        new Request(url, {
          method: 'POST',
          headers: {
            origin: 'https://unrelated.example',
            host: 'unrelated.example',
            'x-forwarded-host': 'unrelated.example',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    (error: unknown) => error instanceof CommerceError && error.status === 403,
  );
  // Non-browser API clients can omit Origin; rate limits still apply.
  assert.doesNotThrow(() =>
    assertAllowedOrigin(new Request(url, {method: 'POST'})),
  );
});

test('production requires a valid canonical origin', (t) => {
  environment(t, {NODE_ENV: 'production'});
  for (const value of [
    '',
    'http://desklab.example',
    'https://user:password@desklab.example',
    'https://desklab.example/path',
    'https://desklab.example?key=private',
    'invalid',
  ]) {
    process.env.APP_ORIGIN = value;
    assert.throws(
      () => assertAllowedOrigin(new Request(url)),
      (error: unknown) =>
        error instanceof CommerceError && error.status === 503,
    );
  }
});

test('fetch metadata and opaque origins cannot bypass browser origin checks', (t) => {
  environment(t);
  const variants: Record<string, string>[] = [
    {origin: 'null'},
    {'sec-fetch-site': 'cross-site'},
    {'sec-fetch-site': 'same-site'},
    {'sec-fetch-site': 'same-origin'},
  ];
  for (const headers of variants) {
    assert.throws(
      () => assertAllowedOrigin(new Request(url, {method: 'POST', headers})),
      (error: unknown) =>
        error instanceof CommerceError && error.status === 403,
    );
  }
});

test('Vercel always requires a public HTTPS origin even if NODE_ENV is misconfigured', (t) => {
  environment(t, {NODE_ENV: 'development', VERCEL: '1'});
  for (const value of [
    '',
    'http://desklab.example',
    'http://localhost:3000',
    'https://127.0.0.1',
  ]) {
    process.env.APP_ORIGIN = value;
    assert.throws(
      () => assertAllowedOrigin(new Request(url)),
      (error: unknown) =>
        error instanceof CommerceError && error.status === 503,
    );
  }
  process.env.APP_ORIGIN = 'https://desklab.example';
  assert.doesNotThrow(() => assertAllowedOrigin(new Request(url)));
});

test('public catalog and checkout fail before upstream access when required protection is absent', async (t) => {
  environment(t, {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://desklab.example',
  });
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected upstream call');
  });
  const log = t.mock.method(console, 'info', () => {});
  const responses = await Promise.all([
    catalogRoute(new Request('https://desklab.example/api/catalog')),
    checkoutRoute(
      new Request(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: '{"lines":[]}',
      }),
    ),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '30');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {
      error: 'The service is temporarily unavailable. Please try again.',
    });
  }
  assert.equal(network.mock.calls.length, 0);
  assert.equal(log.mock.calls.length, 2);
});

test('a shared route allowance denial returns 429 and never calls its handler', async (t) => {
  environment(t, {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://desklab.example',
    UPSTASH_REDIS_REST_URL: 'https://desklab-test.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'test-only-token',
    RATE_LIMIT_IP_HASH_SECRET: 'test-only-secret-with-more-than-32-characters',
  });
  t.mock.method(console, 'info', () => {});
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({result: [0, 19]}),
  );
  let called = false;
  const response = await handleApiRequest(
    'checkout',
    new Request(url),
    async () => {
      called = true;
      return Response.json({checkoutUrl: 'private-checkout-url'});
    },
  );
  assert.equal(called, false);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '19');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('production diagnostics contain only the route, status and duration, including unexpected failures', async (t) => {
  environment(t, {
    NODE_ENV: 'production',
    APP_ORIGIN: 'http://127.0.0.1:3001',
    RATE_LIMIT_BACKEND: 'memory',
  });
  const logs = t.mock.method(console, 'info', () => {});
  const response = await handleApiRequest(
    'catalog',
    new Request('http://127.0.0.1:3001/api/catalog?prompt=private-prompt', {
      headers: {
        cookie: 'private-cookie',
        'x-forwarded-for': '192.0.2.42',
        authorization: 'private-key',
      },
    }),
    async () => {
      throw new Error('private-checkout-url');
    },
  );
  assert.equal(response.status, 502);
  assert.equal(logs.mock.calls.length, 1);
  const event = JSON.parse(logs.mock.calls[0].arguments[0]);
  assert.deepEqual(Object.keys(event), [
    'event',
    'route',
    'status',
    'durationMs',
  ]);
  assert.equal(event.event, 'api_request');
  assert.equal(event.route, 'catalog');
  assert.equal(event.status, 502);
  assert.equal(
    Number.isInteger(event.durationMs) && event.durationMs >= 0,
    true,
  );
  assert.equal(JSON.stringify(event).includes('private'), false);
  assert.equal(JSON.stringify(event).includes('192.0.2.42'), false);
});

test('health is a non-cacheable safe readiness response without commerce or AI calls', async (t) => {
  environment(t, {
    NODE_ENV: 'production',
    APP_ORIGIN: 'http://127.0.0.1:3001',
    RATE_LIMIT_BACKEND: 'memory',
  });
  t.mock.method(console, 'info', () => {});
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('No external health calls in local mode');
  });
  const ready = await healthRoute(
    new Request('http://127.0.0.1:3001/api/health'),
  );
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await ready.json(), {status: 'ok'});
  process.env.APP_ORIGIN = 'https://desklab.example';
  const unavailable = await healthRoute(
    new Request('https://desklab.example/api/health'),
  );
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {status: 'unavailable'});
  assert.equal(network.mock.calls.length, 0);
});

test('production security headers allow local assets while restricting framing, forms and script evaluation', async (t) => {
  environment(t, {NODE_ENV: 'production'});
  const rules = await nextConfig.headers?.();
  assert.equal(rules?.[0].source, '/:path*');
  const headers = Object.fromEntries(
    rules![0].headers.map(({key, value}) => [key, value]),
  );
  assert.equal(nextConfig.poweredByHeader, false);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.equal(headers['Strict-Transport-Security'], 'max-age=31536000');
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(headers['Content-Security-Policy'], /form-action 'self'/);
  assert.match(headers['Content-Security-Policy'], /object-src 'none'/);
  assert.match(
    headers['Content-Security-Policy'],
    /img-src 'self' data: blob:/,
  );
  assert.match(headers['Content-Security-Policy'], /connect-src 'self';/);
  assert.equal(
    headers['Content-Security-Policy'].includes('unsafe-eval'),
    false,
  );
  assert.equal(headers['Content-Security-Policy'].includes('ws:'), false);
});

test('development headers preserve hot reload without imposing HTTPS on local development', async (t) => {
  environment(t, {NODE_ENV: 'development'});
  const rules = await nextConfig.headers?.();
  const headers = Object.fromEntries(
    rules![0].headers.map(({key, value}) => [key, value]),
  );
  assert.match(headers['Content-Security-Policy'], /'unsafe-eval'/);
  assert.match(
    headers['Content-Security-Policy'],
    /connect-src 'self' ws: wss:/,
  );
  assert.equal(headers['Strict-Transport-Security'], undefined);
  assert.equal(
    headers['Content-Security-Policy'].includes('upgrade-insecure-requests'),
    false,
  );
});
