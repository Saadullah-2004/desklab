import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {REQUEST_LIMITS, type LimitedRoute} from '../../src/lib/rate-limit';
import {startFixture, type Job} from './harness';

const minute = 60_000;
const day = 86_400_000;
const now = 20_000 * day + 23_000;
const routes: LimitedRoute[] = ['catalog', 'recommend', 'checkout'];

test(
  'production Lua and application boundaries against disposable real Redis',
  {timeout: 120_000},
  async (t) => {
    const redis = await startFixture();
    t.after(redis.cleanup);
    const scriptHashes = new Set<string>();
    const workerPids = new Set<number>();
    let commandCount = 0;
    let scenarioCount = 0;
    const run = async (job: Job) => {
      const replies = await redis.run(job);
      for (const reply of replies) {
        assert.equal(
          reply.externalCalls,
          0,
          'No provider or external network calls are allowed',
        );
        commandCount += reply.redisCalls;
        workerPids.add(reply.pid);
        reply.scripts.forEach((script) => scriptHashes.add(script));
      }
      return replies.flatMap((reply) => reply.outcomes);
    };
    const keys = async () => (await redis.command('KEYS', '*')) as string[];
    const snapshot = async () => {
      const names = (await keys()).sort();
      return Promise.all(
        names.map(async (key) => [key, await redis.command('GET', key)]),
      );
    };
    const verifyExpiry = async () => {
      // Callers first assert production TTLs, then shorten only the disposable
      // fixture's expiry to observe cleanup without a two-day CI wait.
      for (const key of await keys()) await redis.command('PEXPIRE', key, '50');
      for (let attempt = 0; attempt < 100 && (await keys()).length; attempt++)
        await delay(20);
      assert.deepEqual(await keys(), []);
    };
    const scenario = async (name: string, check: () => Promise<void>) => {
      await t.test(name, async () => {
        await redis.command('FLUSHDB');
        await check();
        scenarioCount++;
      });
    };

    for (const route of routes) {
      const limits = REQUEST_LIMITS[route];
      await scenario(
        `${route}: four processes share the client cap and denied requests change no counters`,
        async () => {
          const outcomes = await run({
            action: 'rate',
            route,
            now,
            count: limits.clientMinute + 2,
          });
          assert.equal(
            outcomes.filter((result) => result.allowed).length,
            limits.clientMinute,
          );
          for (const denied of outcomes.filter((result) => !result.allowed)) {
            assert.deepEqual(denied, {
              allowed: false,
              reason: 'limited',
              retryAfterSeconds: 37,
            });
          }
          const counters = await snapshot();
          assert.equal(counters.length, 3);
          assert.ok(
            counters.every(
              ([, count]) => count === String(limits.clientMinute),
            ),
          );
          await run({action: 'rate', route, now, count: 3});
          assert.deepEqual(await snapshot(), counters);
          const nextClient = await run({
            action: 'rate',
            route,
            now,
            count: 1,
            uniqueClients: true,
          });
          assert.ok(nextClient.every((result) => result.allowed));
        },
      );

      await scenario(
        `${route}: four processes cannot exceed the global minute cap by rotating clients`,
        async () => {
          const outcomes = await run({
            action: 'rate',
            route,
            now,
            count: Math.ceil(limits.globalMinute / 4) + 2,
            uniqueClients: true,
          });
          assert.equal(
            outcomes.filter((result) => result.allowed).length,
            limits.globalMinute,
          );
          assert.ok(
            outcomes
              .filter((result) => !result.allowed)
              .every((result) => result.reason === 'limited'),
          );
          const counters = await snapshot();
          assert.equal(
            counters.length,
            limits.globalMinute + 2,
            'Denied clients create no counters',
          );
          assert.equal(
            await redis.command(
              'GET',
              `desklab:api:v1:${route}:minute:${Math.floor(now / minute)}`,
            ),
            String(limits.globalMinute),
          );
          assert.equal(
            await redis.command(
              'GET',
              `desklab:api:v1:${route}:day:${Math.floor(now / day)}`,
            ),
            String(limits.globalMinute),
          );
          const api = await run({
            action: 'api',
            route,
            now,
            count: 1,
            uniqueClients: true,
          });
          assert.ok(
            api.every(
              (result) =>
                result.status === 429 &&
                result.retryAfter === '37' &&
                result.cacheControl === 'no-store',
            ),
          );
          assert.deepEqual(await snapshot(), counters);
        },
      );

      await scenario(
        `${route}: daily cap survives minute rollover, denies atomically, then resets at UTC midnight`,
        async () => {
          let admitted = 0;
          const windows = Math.ceil(limits.globalDay / limits.globalMinute);
          for (let window = 0; window < windows; window++) {
            const outcomes = await run({
              action: 'rate',
              route,
              now: now + window * minute,
              count: Math.ceil(limits.globalMinute / 4) + 2,
              uniqueClients: true,
            });
            admitted += outcomes.filter((result) => result.allowed).length;
          }
          assert.equal(admitted, limits.globalDay);
          const counters = await snapshot();
          const deniedTime = now + windows * minute;
          const denied = await run({
            action: 'rate',
            route,
            now: deniedTime,
            count: 2,
            uniqueClients: true,
          });
          assert.ok(
            denied.every(
              (result) =>
                !result.allowed &&
                result.retryAfterSeconds ===
                  86_400 - (Math.floor(deniedTime / 1_000) % 86_400),
            ),
          );
          assert.deepEqual(
            await snapshot(),
            counters,
            'A day denial must not create new-minute or client counters',
          );
          assert.ok(
            (
              await run({
                action: 'rate',
                route,
                now: Math.floor(now / day) * day + day,
                count: 1,
                uniqueClients: true,
              })
            ).every((result) => result.allowed),
          );
        },
      );
    }

    await scenario(
      'minute boundary opens new API counters while retaining the daily counter and bounded TTLs',
      async () => {
        const before = Math.floor(now / minute) * minute + minute - 1;
        const outcomes = await run({
          action: 'rate',
          route: 'checkout',
          now: before,
          count: 3,
        });
        assert.equal(outcomes.filter((result) => result.allowed).length, 5);
        assert.ok(
          outcomes
            .filter((result) => !result.allowed)
            .every((result) => result.retryAfterSeconds === 1),
        );
        const oldKeys = await keys();
        const ttlBefore = new Map<string, number>();
        for (const key of oldKeys) {
          const ttl = Number(await redis.command('PTTL', key));
          const expected = key.includes(':day:') ? 172_800_000 : 120_000;
          assert.ok(ttl <= expected && ttl > expected - 15_000);
          ttlBefore.set(key, ttl);
        }
        await delay(100);
        const next = await run({
          action: 'rate',
          route: 'checkout',
          now: before + 1,
          count: 1,
        });
        assert.ok(next.every((result) => result.allowed));
        assert.equal((await keys()).length, 5);
        for (const key of oldKeys) {
          assert.ok(
            Number(await redis.command('PTTL', key)) < ttlBefore.get(key)!,
            'Neither allowed nor denied requests extend existing API key TTLs',
          );
        }
        assert.equal(
          await redis.command(
            'GET',
            oldKeys.find((key) => key.includes(':day:'))!,
          ),
          '9',
        );
        await verifyExpiry();
      },
    );

    await scenario(
      'AI allowance admits exactly five across four processes with unchanged counters and TTLs on denial',
      async () => {
        const outcomes = await run({action: 'ai', now, count: 5});
        assert.equal(outcomes.filter((result) => result.allowed).length, 5);
        const counters = await snapshot();
        assert.equal(counters.length, 2);
        assert.ok(counters.every(([, value]) => value === '5'));
        const ttlBefore = new Map<string, number>();
        for (const key of await keys()) {
          const ttl = Number(await redis.command('PTTL', key));
          const expected = key.includes(':day:') ? 172_800_000 : 120_000;
          assert.ok(ttl <= expected && ttl > expected - 15_000);
          ttlBefore.set(key, ttl);
        }
        await delay(100);
        const fallback = await run({action: 'interpret', now, count: 1});
        assert.ok(fallback.every((result) => result.engine === 'rules'));
        assert.deepEqual(await snapshot(), counters);
        for (const [key, ttl] of ttlBefore)
          assert.ok(Number(await redis.command('PTTL', key)) < ttl);
        assert.ok(
          (await run({action: 'ai', now: now + minute, count: 1})).every(
            (result) => result.allowed,
          ),
        );
        assert.equal(
          await redis.command('GET', `desklab:ai:day:${Math.floor(now / day)}`),
          '9',
        );
        await verifyExpiry();
      },
    );

    await scenario(
      'AI daily allowance stops at fifty across minute windows and resets at UTC midnight',
      async () => {
        let admitted = 0;
        for (let window = 0; window < 11; window++) {
          const outcomes = await run({
            action: 'ai',
            now: now + window * minute,
            count: 3,
          });
          admitted += outcomes.filter((result) => result.allowed).length;
        }
        assert.equal(admitted, 50);
        const counters = await snapshot();
        assert.equal(
          counters.length,
          11,
          'The denied eleventh window creates no key',
        );
        assert.ok(
          (await run({action: 'ai', now: now + 12 * minute, count: 3})).every(
            (result) => !result.allowed,
          ),
        );
        assert.deepEqual(await snapshot(), counters);
        assert.ok(
          (
            await run({
              action: 'ai',
              now: Math.floor(now / day) * day + day,
              count: 1,
            })
          ).every((result) => result.allowed),
        );
      },
    );

    await scenario(
      'real Redis script errors fail closed through every API route and AI fallback',
      async () => {
        // A nonnumeric value makes Redis reject the actual Lua arithmetic. This
        // checks a real script error, not a hand-written fake success/error result.
        for (const route of routes) {
          await redis.command(
            'SET',
            `desklab:api:v1:${route}:minute:${Math.floor(now / minute)}`,
            'not-a-counter',
          );
          const results = await run({action: 'api', route, now, count: 1});
          for (const result of results) {
            assert.deepEqual(result, {
              status: 503,
              retryAfter: '30',
              cacheControl: 'no-store',
              body: {
                error:
                  'The service is temporarily unavailable. Please try again.',
              },
            });
          }
        }
        await redis.command(
          'SET',
          `desklab:ai:minute:${Math.floor(now / minute)}`,
          'not-a-counter',
        );
        assert.ok(
          (await run({action: 'interpret', now, count: 1})).every(
            (result) => result.engine === 'rules',
          ),
        );
        assert.equal(
          (await keys()).length,
          4,
          'Script failures create no other counters',
        );
      },
    );

    await scenario(
      'stopped Redis fails closed at all API routes, readiness and AI fallback without provider calls',
      async () => {
        assert.ok(
          (await run({action: 'rate', route: 'catalog', now, count: 1})).every(
            (result) => result.allowed,
          ),
        );
        await redis.stopRedis();
        for (const route of routes) {
          const results = await run({action: 'api', route, now, count: 1});
          for (const result of results) {
            assert.deepEqual(result, {
              status: 503,
              retryAfter: '30',
              cacheControl: 'no-store',
              body: {
                error:
                  'The service is temporarily unavailable. Please try again.',
              },
            });
          }
        }
        assert.ok(
          (await run({action: 'ai', now, count: 1})).every(
            (result) => !result.allowed,
          ),
        );
        assert.ok(
          (await run({action: 'interpret', now, count: 1})).every(
            (result) => result.engine === 'rules',
          ),
        );
        assert.ok(
          (await run({action: 'health', now, count: 1})).every(
            (result) => !result.allowed,
          ),
        );
      },
    );

    assert.equal(workerPids.size, 4);
    assert.equal(scriptHashes.size, 2);
    assert.equal(scenarioCount, 14);
    await redis.cleanup();
    await assert.rejects(access(redis.directory));
    t.diagnostic(
      JSON.stringify({
        suite: 'redis-integration',
        status: 'passed',
        redisVersion: redis.version,
        scenarios: scenarioCount,
        workerProcesses: workerPids.size,
        redisCommands: commandCount,
        productionLuaSha256: [...scriptHashes].sort(),
        externalCalls: 0,
        tcpPort: 0,
        cleanup: 'verified',
        expiryCheck: 'production TTL asserted, expiry accelerated in fixture',
      }),
    );
  },
);
