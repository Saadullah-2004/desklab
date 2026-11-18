import assert from 'node:assert/strict';
import {fork, spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {LimitedRoute} from '../../src/lib/rate-limit';

type RedisValue = string | number | null | RedisValue[];

export class RedisCommandError extends Error {}

// Only transport is adapted. Redis itself parses and executes the unchanged
// production EVAL command, including its Lua, keys, arguments and errors.
export function redisCommand(
  path: string,
  command: string[],
  signal?: AbortSignal | null,
): Promise<RedisValue> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({path});
    let buffer = Buffer.alloc(0);
    const finish = (error?: Error, value?: RedisValue) => {
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(new Error('Redis transport aborted'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, {once: true});
    socket.setTimeout(3_000, () =>
      finish(new Error('Redis transport timeout')),
    );
    socket.once('error', finish);
    socket.once('end', () => finish(new Error('Redis closed before replying')));
    socket.once('connect', () => {
      socket.write(
        `*${command.length}\r\n` +
          command
            .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
            .join(''),
      );
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      function read(offset: number): [RedisValue, number] | undefined {
        const end = buffer.indexOf('\r\n', offset);
        if (end < 0) return;
        const value = buffer.toString('utf8', offset + 1, end);
        const next = end + 2;
        switch (buffer[offset]) {
          case 43:
            return [value, next];
          case 45:
            throw new RedisCommandError(value);
          case 58:
            return [Number(value), next];
          case 36: {
            const length = Number(value);
            if (length === -1) return [null, next];
            if (buffer.length < next + length + 2) return;
            return [
              buffer.toString('utf8', next, next + length),
              next + length + 2,
            ];
          }
          case 42: {
            const values: RedisValue[] = [];
            let cursor = next;
            for (let index = 0; index < Number(value); index++) {
              const item = read(cursor);
              if (!item) return;
              values.push(item[0]);
              cursor = item[1];
            }
            return [values, cursor];
          }
          default:
            throw new Error('Unsupported Redis response');
        }
      }
      try {
        const reply = read(0);
        if (reply) finish(undefined, reply[0]);
      } catch (error) {
        finish(error as Error);
      }
    });
  });
}

async function stop(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 3_000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}

export type Job = {
  action: 'rate' | 'ai' | 'api' | 'interpret' | 'health';
  now: number;
  count: number;
  route?: LimitedRoute;
  uniqueClients?: boolean;
};

export type Outcome = {
  allowed?: boolean;
  reason?: string;
  retryAfterSeconds?: number;
  status?: number;
  retryAfter?: string | null;
  cacheControl?: string | null;
  body?: unknown;
  engine?: string;
};

type WorkerReply = {
  outcomes: Outcome[];
  externalCalls: number;
  redisCalls: number;
  scripts: string[];
  pid: number;
};

export async function startFixture() {
  // A short private directory avoids macOS's Unix socket path length limit.
  const directory = await mkdtemp('/tmp/desklab-redis-');
  const socket = join(directory, 'redis.sock');
  const children: ChildProcess[] = [];
  const killOnExit = () => children.forEach((child) => child.kill('SIGTERM'));
  const cleanup = async () => {
    await Promise.all(children.map(stop));
    await rm(directory, {recursive: true, force: true});
    process.removeListener('exit', killOnExit);
    process.removeListener('SIGTERM', interrupted);
    process.removeListener('SIGINT', interrupted);
  };
  const interrupted = () => {
    void cleanup().finally(() => process.exit(1));
  };
  process.once('exit', killOnExit);
  process.once('SIGTERM', interrupted);
  process.once('SIGINT', interrupted);
  const redis = spawn(
    process.env.REDIS_SERVER_BIN || 'redis-server',
    [
      '--port',
      '0',
      '--unixsocket',
      socket,
      '--unixsocketperm',
      '700',
      '--save',
      '',
      '--appendonly',
      'no',
      '--dir',
      directory,
      '--daemonize',
      'no',
      '--protected-mode',
      'yes',
      '--loglevel',
      'warning',
    ],
    {stdio: 'ignore', env: {PATH: process.env.PATH, NODE_ENV: 'test'}},
  );
  children.push(redis);
  let startupError: Error | undefined;
  redis.on('error', (error) => {
    startupError = error;
  });
  const command = (...parts: string[]) => redisCommand(socket, parts);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError || redis.exitCode !== null) break;
      try {
        ready = (await command('PING')) === 'PONG';
        if (ready) break;
      } catch {}
      await delay(50);
    }
    assert.ok(
      ready,
      'Redis must start. Install redis-server or set REDIS_SERVER_BIN to an executable; this suite never skips missing Redis.',
    );
    assert.deepEqual(await command('CONFIG', 'GET', 'port'), ['port', '0']);
    assert.deepEqual(await command('CONFIG', 'GET', 'save'), ['save', '']);
    assert.deepEqual(await command('CONFIG', 'GET', 'appendonly'), [
      'appendonly',
      'no',
    ]);
    const info = String(await command('INFO', 'server'));
    const version = info.match(/redis_version:([^\r\n]+)/)?.[1];
    assert.ok(version);
    const workers = Array.from({length: 4}, (_, index) => {
      const child = fork(new URL('./worker.ts', import.meta.url), [], {
        execArgv: ['--conditions=react-server', '--import', 'tsx'],
        // Do not inherit credentials, NODE_OPTIONS or provider configuration.
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          REDIS_TEST_SOCKET: socket,
          REDIS_TEST_WORKER: String(index),
        },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      children.push(child);
      return child;
    });
    await Promise.all(
      workers.map(
        (child) =>
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Redis test worker did not start')),
              10_000,
            );
            child.once('message', (message) => {
              clearTimeout(timeout);
              assert.deepEqual(message, {ready: true});
              resolve();
            });
            child.once('error', reject);
          }),
      ),
    );
    return {
      directory,
      socket,
      version,
      command,
      cleanup,
      stopRedis: () => stop(redis),
      async run(job: Job): Promise<WorkerReply[]> {
        // All workers have imported the production modules before this barrier.
        return Promise.all(
          workers.map(
            (child) =>
              new Promise<WorkerReply>((resolve, reject) => {
                const timeout = setTimeout(
                  () => reject(new Error('Redis test worker timed out')),
                  15_000,
                );
                child.once('message', (message) => {
                  clearTimeout(timeout);
                  const reply = message as WorkerReply & {error?: string};
                  if (reply.error) reject(new Error(reply.error));
                  else resolve(reply);
                });
                child.send(job);
              }),
          ),
        );
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
