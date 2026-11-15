import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  checkRateLimit,
  rateLimiterReady,
  REQUEST_LIMITS,
} from '../src/lib/rate-limit';

const minute = 60_000;
const day = 86_400_000;
const local = {
  NODE_ENV: 'development',
  RATE_LIMIT_CLIENT_IP_HEADER: 'x-real-ip',
};
const redis = {
  NODE_ENV: 'production',
  UPSTASH_REDIS_REST_URL: 'https://desklab-test.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-only-redis-token',
  RATE_LIMIT_IP_HASH_SECRET: 'test-only-hmac-secret-with-32-characters',
  VERCEL: '1',
};

function request(ip = '192.0.2.1', header = 'x-real-ip') {
  return new Request(
    'https://desklab.example/api/recommend?brief=private-brief',
    {
      headers: {[header]: ip, cookie: 'private-cookie'},
    },
  );
}

test('local limits apply per client, allow another client and reset at the next minute', async () => {
  const now = 1_000 * day + 23_000;
  for (let index = 0; index < REQUEST_LIMITS.recommend.clientMinute; index++)
    assert.deepEqual(await checkRateLimit('recommend', request(), local, now), {
      allowed: true,
    });
  assert.deepEqual(await checkRateLimit('recommend', request(), local, now), {
    allowed: false,
    reason: 'limited',
    retryAfterSeconds: 37,
  });
  assert.deepEqual(
    await checkRateLimit('recommend', request('192.0.2.2'), local, now),
    {allowed: true},
  );
  assert.deepEqual(
    await checkRateLimit('recommend', request(), local, now + minute),
    {allowed: true},
  );
});

test('global minute limits cannot be avoided by changing clients', async () => {
  const now = 1_001 * day;
  for (let index = 0; index < REQUEST_LIMITS.recommend.globalMinute; index++)
    assert.deepEqual(
      await checkRateLimit(
        'recommend',
        request(`192.0.2.${index + 1}`),
        local,
        now,
      ),
      {allowed: true},
    );
  assert.deepEqual(
    await checkRateLimit('recommend', request('192.0.2.200'), local, now),
    {
      allowed: false,
      reason: 'limited',
      retryAfterSeconds: 60,
    },
  );
});

test('global daily limits persist across minute windows and expire at the UTC day boundary', async () => {
  const now = 1_002 * day;
  for (let index = 0; index < REQUEST_LIMITS.checkout.globalDay; index++) {
    const time =
      now + Math.floor(index / REQUEST_LIMITS.checkout.globalMinute) * minute;
    assert.deepEqual(
      await checkRateLimit(
        'checkout',
        request(`192.0.2.${index + 1}`),
        local,
        time,
      ),
      {allowed: true},
    );
  }
  assert.deepEqual(
    await checkRateLimit(
      'checkout',
      request('192.0.2.200'),
      local,
      now + 5 * minute,
    ),
    {
      allowed: false,
      reason: 'limited',
      retryAfterSeconds: 86_100,
    },
  );
  assert.deepEqual(
    await checkRateLimit('checkout', request('192.0.2.200'), local, now + day),
    {allowed: true},
  );
});

test('untrusted forwarded headers cannot rotate the shared client allowance', async () => {
  const now = 1_004 * day;
  for (let index = 0; index < REQUEST_LIMITS.checkout.clientMinute; index++)
    assert.deepEqual(
      await checkRateLimit(
        'checkout',
        request(`192.0.2.${index + 1}`, 'x-forwarded-for'),
        {NODE_ENV: 'development'},
        now,
      ),
      {allowed: true},
    );
  assert.equal(
    (
      await checkRateLimit(
        'checkout',
        request('192.0.2.200', 'x-forwarded-for'),
        {NODE_ENV: 'development'},
        now,
      )
    ).allowed,
    false,
  );
});

test('production and explicitly configured Redis never fall back to memory on missing or invalid settings', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Must not call invalid endpoint');
  });
  for (const environment of [
    {NODE_ENV: 'production'},
    {NODE_ENV: 'development', VERCEL: '1'},
    {NODE_ENV: 'development', RATE_LIMIT_BACKEND: 'redis'},
    {...redis, RATE_LIMIT_IP_HASH_SECRET: ''},
    {...redis, RATE_LIMIT_IP_HASH_SECRET: 'short'},
    {...redis, UPSTASH_REDIS_REST_URL: 'https://untrusted.example'},
    {...redis, RATE_LIMIT_CLIENT_IP_HEADER: 'cookie'},
    {...redis, RATE_LIMIT_BACKEND: 'disabled'},
  ]) {
    assert.deepEqual(await checkRateLimit('catalog', request(), environment), {
      allowed: false,
      reason: 'unavailable',
      retryAfterSeconds: 30,
    });
  }
  assert.equal(network.mock.calls.length, 0);
});

test('the explicit memory backend works for local production tests but never Vercel or a public origin', async () => {
  const environment = {
    NODE_ENV: 'production',
    RATE_LIMIT_BACKEND: 'memory',
    APP_ORIGIN: 'http://127.0.0.1:3001',
  };
  assert.deepEqual(
    await checkRateLimit('catalog', request(), environment, 1_005 * day),
    {allowed: true},
  );
  for (const invalid of [
    {...environment, APP_ORIGIN: 'https://desklab.example'},
    {...environment, APP_ORIGIN: ''},
    {...environment, VERCEL: '1'},
    {...environment, VERCEL: '0'},
  ]) {
    assert.equal(
      (await checkRateLimit('catalog', request(), invalid)).allowed,
      false,
    );
  }
});

test('Redis receives one atomic command with rotating HMAC client keys and no raw request data', async (t) => {
  const commands: string[][] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (url: unknown, init: RequestInit) => {
      assert.equal(url, redis.UPSTASH_REDIS_REST_URL);
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      commands.push(JSON.parse(String(init.body)));
      return Response.json({result: [1, 0]});
    },
  );
  const now = 1_006 * day;
  const caller = request('192.0.2.42', 'x-vercel-forwarded-for');
  assert.deepEqual(await checkRateLimit('recommend', caller, redis, now), {
    allowed: true,
  });
  await checkRateLimit('recommend', caller, redis, now);
  await checkRateLimit(
    'recommend',
    request('192.0.2.43', 'x-vercel-forwarded-for'),
    redis,
    now,
  );
  await checkRateLimit('recommend', caller, redis, now + day);
  assert.equal(commands.length, 4);
  assert.equal(commands[0][0], 'EVAL');
  assert.equal(commands[0][2], '3');
  assert.equal(commands[0][5], commands[1][5]);
  assert.notEqual(commands[0][5], commands[2][5]);
  assert.notEqual(commands[0][5].split(':')[5], commands[3][5].split(':')[5]);
  assert.match(commands[0][5], /:client:[a-f0-9]{64}:\d+$/);
  assert.deepEqual(commands[0].slice(6), [
    '60',
    '120',
    '60',
    '150',
    '172800',
    '86400',
    '12',
    '120',
    '60',
  ]);
  for (const sensitive of [
    '192.0.2.',
    'private-brief',
    'private-cookie',
    redis.RATE_LIMIT_IP_HASH_SECRET,
  ])
    assert.equal(JSON.stringify(commands).includes(sensitive), false);
});

test('Redis denials retain their bounded retry interval', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({result: [0, 41]}),
  );
  assert.deepEqual(await checkRateLimit('checkout', request(), redis), {
    allowed: false,
    reason: 'limited',
    retryAfterSeconds: 41,
  });
});

test('scoped and malformed client addresses use the shared bucket instead of causing a request failure', async (t) => {
  const commands: string[][] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init: RequestInit) => {
      commands.push(JSON.parse(String(init.body)));
      return Response.json({result: [1, 0]});
    },
  );
  for (const ip of ['fe80::1%eth0', 'not-an-address', '']) {
    assert.deepEqual(
      await checkRateLimit(
        'catalog',
        request(ip, 'x-vercel-forwarded-for'),
        redis,
        1_007 * day,
      ),
      {allowed: true},
    );
  }
  assert.equal(commands[0][5], commands[1][5]);
  assert.equal(commands[1][5], commands[2][5]);
});

test('Redis errors, malformed responses and network failures fail closed without logging provider details', async (t) => {
  const logs = t.mock.method(console, 'info', () => {});
  const fixtures = [
    () => Response.json({result: [1, 0]}, {status: 503}),
    () => Response.json({error: 'private-provider-error'}),
    () => Response.json({result: [0, -1]}),
    () => Response.json({result: [0, 86_401]}),
    () => Response.json({result: [1, 10]}),
    () => Response.json({result: true}),
    () => new Response('not-json'),
    () => {
      throw new Error('private-provider-error');
    },
  ];
  const network = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({result: [1, 0]}),
  );
  for (const fixture of fixtures) {
    network.mock.mockImplementation(async () => fixture());
    assert.deepEqual(await checkRateLimit('catalog', request(), redis), {
      allowed: false,
      reason: 'unavailable',
      retryAfterSeconds: 30,
    });
  }
  assert.equal(logs.mock.calls.length, 0);
});

test('health collapses concurrent Redis probes and does not spend route or model allowances', async (t) => {
  const network = t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init: RequestInit) => {
      assert.deepEqual(JSON.parse(String(init.body)), ['PING']);
      return Response.json({result: 'PONG'});
    },
  );
  assert.deepEqual(
    await Promise.all([rateLimiterReady(redis), rateLimiterReady(redis)]),
    [true, true],
  );
  assert.equal(await rateLimiterReady(redis), true);
  assert.equal(network.mock.calls.length, 1);
});

test('health reports unavailable protection without exposing upstream failure details', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({error: 'private-provider-error'}, {status: 503}),
  );
  assert.equal(
    await rateLimiterReady({
      ...redis,
      UPSTASH_REDIS_REST_TOKEN: 'different-test-token',
    }),
    false,
  );
  assert.equal(await rateLimiterReady({NODE_ENV: 'production'}), false);
});
