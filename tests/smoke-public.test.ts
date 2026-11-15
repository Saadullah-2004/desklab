import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  smokePublic,
  smokeTarget,
  publicOrigin,
  SmokeError,
} from '../scripts/smoke-public';
import {products} from '../src/lib/catalog';
import {recommendSetup} from '../src/lib/recommend';

const origin = 'https://desklab-portfolio.vercel.app';
const liveProducts = products.map((product, index) => ({
  ...product,
  shopifyVariantId: `gid://shopify/ProductVariant/${index + 1}`,
}));
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
};

function fixture(path: string, init?: RequestInit): Response {
  if (path === '/')
    return new Response(
      '<html><title>DeskLab | Make room for your best work</title></html>',
      {headers: {...securityHeaders, 'Content-Type': 'text/html'}},
    );
  if (path === '/api/health')
    return Response.json({status: 'ok'}, {headers: securityHeaders});
  if (path === '/api/catalog')
    return Response.json(
      {source: 'shopify', checkoutEnabled: true, products: liveProducts},
      {headers: securityHeaders},
    );
  assert.equal(path, '/api/recommend');
  const body = JSON.parse(String(init?.body));
  return Response.json(
    {
      ...recommendSetup(body.preferences, liveProducts),
      engine: 'rules',
      catalogSource: 'shopify',
      catalogSnapshot: liveProducts,
    },
    {headers: securityHeaders},
  );
}

test('public smoke uses exactly four bounded requests and never creates a cart or nonempty AI brief', async () => {
  const calls: {path: string; init?: RequestInit}[] = [];
  const report = await smokePublic(origin, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, origin);
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get('origin'), origin);
    calls.push({path: url.pathname, init});
    return fixture(url.pathname, init);
  });
  assert.deepEqual(
    calls.map((call) => [call.path, call.init?.method]),
    [
      ['/', 'GET'],
      ['/api/health', 'GET'],
      ['/api/catalog', 'GET'],
      ['/api/recommend', 'POST'],
    ],
  );
  assert.equal(JSON.parse(String(calls[3].init?.body)).brief, '');
  assert.equal(report.productCount, 18);
  assert.equal(report.checkoutEnabled, true);
  assert.equal(report.checks.length, 4);
});

test('smoke target validation requires a canonical public HTTPS origin and supports explicit override', () => {
  assert.equal(smokeTarget([], {APP_ORIGIN: `${origin}/`}), origin);
  assert.equal(smokeTarget(['--url', origin], {APP_ORIGIN: 'invalid'}), origin);
  assert.equal(smokeTarget([`--url=${origin}`], {}), origin);
  for (const value of [
    undefined,
    'http://desklab-portfolio.vercel.app',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://service.internal',
    `${origin}:8443`,
    `${origin}/path`,
    `${origin}?key=private-token`,
    `${origin}#private-token`,
    'https://user:private-token@desklab-portfolio.vercel.app',
  ]) {
    assert.throws(() => publicOrigin(value), SmokeError);
  }
  for (const args of [
    ['--url'],
    ['--unknown'],
    ['--url', origin, '--url', origin],
  ])
    assert.throws(() => smokeTarget(args, {}), SmokeError);
});

test('redirects and provider errors stop immediately without logging response bodies or locations', async () => {
  for (const status of [308, 401, 429, 503]) {
    let calls = 0;
    await assert.rejects(
      smokePublic(origin, async () => {
        calls++;
        return new Response('private upstream body', {
          status,
          headers: {Location: 'https://private.example/?token=secret'},
        });
      }),
      (error: unknown) =>
        error instanceof SmokeError &&
        error.message.includes(String(status)) &&
        !error.message.includes('private') &&
        !error.message.includes('secret'),
    );
    assert.equal(calls, 1);
  }
});

test('the smoke check rejects missing security headers and a fixture catalog presented as live', async () => {
  await assert.rejects(
    smokePublic(
      origin,
      async () =>
        new Response('<title>DeskLab | Demo</title>', {
          headers: {'Content-Type': 'text/html'},
        }),
    ),
    /security headers/,
  );
  await assert.rejects(
    smokePublic(origin, async (input, init) => {
      const path = new URL(String(input)).pathname;
      return path === '/api/catalog'
        ? Response.json(
            {source: 'demo', checkoutEnabled: false, products},
            {headers: securityHeaders},
          )
        : fixture(path, init);
    }),
    /connected Shopify catalog/,
  );
});

test('the smoke check validates recommendation totals independently of a feasible flag', async () => {
  await assert.rejects(
    smokePublic(origin, async (input, init) => {
      const path = new URL(String(input)).pathname;
      const response = fixture(path, init);
      if (path !== '/api/recommend') return response;
      const payload = await response.json();
      return Response.json(
        {...payload, totalCents: payload.totalCents + 1},
        {headers: securityHeaders},
      );
    }),
    /total validation failed/,
  );
});

test('fetch errors are sanitized and never retried', async () => {
  let calls = 0;
  await assert.rejects(
    smokePublic(origin, async () => {
      calls++;
      throw new Error('private network credentials');
    }),
    (error: unknown) =>
      error instanceof SmokeError &&
      error.message === 'Homepage: request failed or timed out.',
  );
  assert.equal(calls, 1);
});
