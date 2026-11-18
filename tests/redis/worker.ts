import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkRateLimit, rateLimiterReady} from '../../src/lib/rate-limit';
import {
  DEFAULT_PREFERENCES,
  FREE_TIER_MODEL,
  interpretBrief,
  reserveAiRequest,
} from '../../src/lib/ai';
import {GET as catalog} from '../../src/app/api/catalog/route';
import {POST as recommend} from '../../src/app/api/recommend/route';
import {POST as checkout} from '../../src/app/api/checkout/route';
import {
  RedisCommandError,
  redisCommand,
  type Job,
  type Outcome,
} from './harness';

const socket = process.env.REDIS_TEST_SOCKET!;
const worker = Number(process.env.REDIS_TEST_WORKER);
assert.match(socket, /^\/tmp\/desklab-redis-[^/]+\/redis.sock$/);
const endpoint = 'https://desklab-redis-integration.upstash.io';
Object.assign(process.env, {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://desklab.example',
  RATE_LIMIT_BACKEND: 'redis',
  RATE_LIMIT_CLIENT_IP_HEADER: 'x-real-ip',
  RATE_LIMIT_IP_HASH_SECRET: 'synthetic-integration-secret-32-characters',
  UPSTASH_REDIS_REST_URL: endpoint,
  UPSTASH_REDIS_REST_TOKEN: 'synthetic-integration-token',
  ENABLE_LIVE_AI: 'true',
  GEMINI_FREE_TIER_CONFIRMED: 'true',
  GEMINI_API_KEY: 'synthetic-provider-key-never-sent',
  GEMINI_MODEL: FREE_TIER_MODEL,
});
let externalCalls = 0;
let redisCalls = 0;
const scripts = new Set<string>();
globalThis.fetch = async (input, init) => {
  if (input !== endpoint) {
    externalCalls++;
    throw new Error(
      'External network is prohibited by the integration harness',
    );
  }
  assert.equal(init?.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  assert.ok(init.signal);
  const command: unknown = JSON.parse(String(init.body));
  assert.ok(
    Array.isArray(command) && command.every((part) => typeof part === 'string'),
  );
  assert.ok(command[0] === 'EVAL' || command[0] === 'PING');
  redisCalls++;
  if (command[0] === 'EVAL') {
    scripts.add(createHash('sha256').update(command[1]).digest('hex'));
  }
  try {
    return Response.json({
      result: await redisCommand(socket, command, init.signal),
    });
  } catch (error) {
    // Preserve actual Redis command errors in the REST response shape. Socket
    // failures reject fetch, exercising the application's network failure path.
    if (error instanceof RedisCommandError)
      return Response.json({error: error.message});
    throw error;
  }
};

process.on('message', async (job: Job) => {
  externalCalls = 0;
  redisCalls = 0;
  scripts.clear();
  const realNow = Date.now;
  Date.now = () => job.now;
  try {
    const outcomes = await Promise.all(
      Array.from({length: job.count}, async (_, index): Promise<Outcome> => {
        const route = job.route ?? 'checkout';
        const address = job.uniqueClients
          ? `198.18.${worker}.${index + 1}`
          : '192.0.2.1';
        const request = new Request(`https://desklab.example/api/${route}`, {
          method: route === 'catalog' ? 'GET' : 'POST',
          headers: {'x-real-ip': address, 'Content-Type': 'application/json'},
          ...(route === 'catalog'
            ? {}
            : {
                body: JSON.stringify({
                  brief: 'Warm desk under $750',
                  preferences: DEFAULT_PREFERENCES,
                  lines: [],
                }),
              }),
        });
        if (job.action === 'rate')
          return checkRateLimit(route, request, process.env, job.now);
        if (job.action === 'ai') return {allowed: await reserveAiRequest()};
        if (job.action === 'health') return {allowed: await rateLimiterReady()};
        if (job.action === 'interpret') {
          const result = await interpretBrief(
            'Warm desk under $750',
            DEFAULT_PREFERENCES,
          );
          return {engine: result.engine};
        }
        const response = await {catalog, recommend, checkout}[route](request);
        return {
          status: response.status,
          retryAfter: response.headers.get('Retry-After'),
          cacheControl: response.headers.get('Cache-Control'),
          body: await response.json(),
        };
      }),
    );
    process.send?.({
      outcomes,
      redisCalls,
      externalCalls,
      scripts: [...scripts],
      pid: process.pid,
    });
  } catch {
    process.send?.({error: 'Integration worker failed'});
  } finally {
    Date.now = realNow;
  }
});
process.on('disconnect', () => process.exit(0));
process.send?.({ready: true});
