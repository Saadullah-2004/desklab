import 'server-only';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import {
  appOrigin,
  isLoopbackOrigin,
  isProductionRuntime,
  type ServerEnvironment,
} from './server-config';

export type LimitedRoute = 'catalog' | 'recommend' | 'checkout';

// Fixed-window workload caps apply across instances when backed by Redis. They
// are not a guarantee about Redis billing units: denied traffic also uses Redis.
// Keep the account on its Free plan. Provider quota exhaustion fails closed;
// production has no retry or memory fallback and no paid upgrade path here.
export const REQUEST_LIMITS = {
  catalog: {clientMinute: 60, globalMinute: 300, globalDay: 800},
  recommend: {clientMinute: 12, globalMinute: 60, globalDay: 150},
  checkout: {clientMinute: 5, globalMinute: 20, globalDay: 50},
} as const;

type Decision =
  | {allowed: true}
  | {
      allowed: false;
      reason: 'limited' | 'unavailable';
      retryAfterSeconds: number;
    };

type Configuration =
  | {backend: 'memory'; secret: string; clientHeader?: string}
  | {
      backend: 'redis';
      endpoint: string;
      token: string;
      secret: string;
      clientHeader?: string;
    }
  | {backend: 'unavailable'};

const localSecret = randomBytes(32).toString('hex');
const proxyHeaders = new Set([
  'x-vercel-forwarded-for',
  'cf-connecting-ip',
  'x-real-ip',
  'x-forwarded-for',
]);

function configuration(environment: ServerEnvironment): Configuration {
  const requestedHeader =
    environment.RATE_LIMIT_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (requestedHeader && !proxyHeaders.has(requestedHeader))
    return {backend: 'unavailable'};
  // A self-hosted reverse proxy must overwrite the explicitly configured header.
  // Without a trusted proxy header, all callers share the conservative client cap.
  const clientHeader =
    environment.VERCEL === '1' ? 'x-vercel-forwarded-for' : requestedHeader;
  const origin = appOrigin(environment);
  if (environment.RATE_LIMIT_BACKEND === 'memory') {
    if (!environment.VERCEL && origin && isLoopbackOrigin(origin))
      return {backend: 'memory', secret: localSecret, clientHeader};
    return {backend: 'unavailable'};
  }
  if (
    environment.RATE_LIMIT_BACKEND &&
    environment.RATE_LIMIT_BACKEND !== 'redis'
  )
    return {backend: 'unavailable'};
  const endpoint = environment.UPSTASH_REDIS_REST_URL;
  const token = environment.UPSTASH_REDIS_REST_TOKEN;
  const secret = environment.RATE_LIMIT_IP_HASH_SECRET;
  if (
    !endpoint &&
    !token &&
    !secret &&
    !environment.RATE_LIMIT_BACKEND &&
    !isProductionRuntime(environment)
  )
    return {backend: 'memory', secret: localSecret, clientHeader};
  if (
    !endpoint ||
    !/^https:\/\/[a-z0-9-]+\.upstash\.io\/?$/.test(endpoint) ||
    !token ||
    !secret ||
    secret.length < 32
  ) {
    return {backend: 'unavailable'};
  }
  return {backend: 'redis', endpoint, token, secret, clientHeader};
}

function clientKey(
  request: Request,
  config: Exclude<Configuration, {backend: 'unavailable'}>,
  now: number,
): string {
  const forwarded =
    config.clientHeader && request.headers.get(config.clientHeader);
  const candidate = forwarded?.split(',')[0]?.trim();
  // Zone identifiers are meaningful only on the local network and cannot be
  // represented by a public URL. Treat them as unknown instead of throwing.
  let identity =
    candidate && !candidate.includes('%') && isIP(candidate)
      ? candidate
      : 'shared';
  if (isIP(identity) === 6)
    identity = new URL(`http://[${identity}]`).hostname.toLowerCase();
  // Daily rotation and expiring counters limit correlation. Raw addresses are
  // never sent to Redis, returned to callers, or written to diagnostics.
  return createHmac('sha256', config.secret)
    .update(`${Math.floor(now / 86_400_000)}:${identity}`)
    .digest('hex');
}

type Counter = {
  key: string;
  limit: number;
  ttlSeconds: number;
  retrySeconds: number;
};

function counters(route: LimitedRoute, client: string, now: number): Counter[] {
  const limits = REQUEST_LIMITS[route];
  const minute = Math.floor(now / 60_000);
  const day = Math.floor(now / 86_400_000);
  const minuteRetry = 60 - (Math.floor(now / 1_000) % 60);
  const dayRetry = 86_400 - (Math.floor(now / 1_000) % 86_400);
  const prefix = `desklab:api:v1:${route}`;
  return [
    {
      key: `${prefix}:minute:${minute}`,
      limit: limits.globalMinute,
      ttlSeconds: 120,
      retrySeconds: minuteRetry,
    },
    {
      key: `${prefix}:day:${day}`,
      limit: limits.globalDay,
      ttlSeconds: 172_800,
      retrySeconds: dayRetry,
    },
    {
      key: `${prefix}:client:${client}:${minute}`,
      limit: limits.clientMinute,
      ttlSeconds: 120,
      retrySeconds: minuteRetry,
    },
  ];
}

const memory = new Map<string, {count: number; expiresAt: number}>();

function reserveInMemory(entries: Counter[], now: number): Decision {
  for (const [key, value] of memory) {
    if (value.expiresAt <= now) memory.delete(key);
  }
  const retry = Math.max(
    0,
    ...entries.map((entry) =>
      (memory.get(entry.key)?.count ?? 0) >= entry.limit
        ? entry.retrySeconds
        : 0,
    ),
  );
  if (retry)
    return {allowed: false, reason: 'limited', retryAfterSeconds: retry};
  const missing = entries.filter((entry) => !memory.has(entry.key)).length;
  // Local/test mode stays bounded and refuses new counters instead of evicting
  // active limits. Public production never falls back to this process-local map.
  if (memory.size + missing > 4_096)
    return {allowed: false, reason: 'unavailable', retryAfterSeconds: 60};
  for (const entry of entries) {
    const existing = memory.get(entry.key);
    memory.set(entry.key, {
      count: (existing?.count ?? 0) + 1,
      expiresAt: existing?.expiresAt ?? now + entry.ttlSeconds * 1_000,
    });
  }
  return {allowed: true};
}

const LIMIT_SCRIPT = `
  local retry = 0
  for i = 1, #KEYS do
    local offset = (i - 1) * 3
    if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[offset + 1]) then
      retry = math.max(retry, tonumber(ARGV[offset + 3]))
    end
  end
  if retry > 0 then return {0, retry} end
  for i = 1, #KEYS do
    local count = redis.call('INCR', KEYS[i])
    if count == 1 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[(i - 1) * 3 + 2])) end
  end
  return {1, 0}
`;

async function redisCommand(
  config: Extract<Configuration, {backend: 'redis'}>,
  command: string[],
): Promise<unknown> {
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error('Request protection unavailable');
  const body = (await response.json()) as {result?: unknown; error?: unknown};
  if (!body || typeof body !== 'object' || body.error)
    throw new Error('Request protection unavailable');
  return body.result;
}

export async function checkRateLimit(
  route: LimitedRoute,
  request: Request,
  environment: ServerEnvironment = process.env,
  now = Date.now(),
): Promise<Decision> {
  const config = configuration(environment);
  const unavailable: Decision = {
    allowed: false,
    reason: 'unavailable',
    retryAfterSeconds: 30,
  };
  if (config.backend === 'unavailable') return unavailable;
  const entries = counters(route, clientKey(request, config, now), now);
  if (config.backend === 'memory') return reserveInMemory(entries, now);
  try {
    const result = await redisCommand(config, [
      'EVAL',
      LIMIT_SCRIPT,
      String(entries.length),
      ...entries.map((entry) => entry.key),
      ...entries.flatMap((entry) => [
        String(entry.limit),
        String(entry.ttlSeconds),
        String(entry.retrySeconds),
      ]),
    ]);
    if (Array.isArray(result) && result.length === 2) {
      if (result[0] === 1 && result[1] === 0) return {allowed: true};
      if (
        result[0] === 0 &&
        Number.isInteger(result[1]) &&
        result[1] > 0 &&
        result[1] <= 86_400
      )
        return {
          allowed: false,
          reason: 'limited',
          retryAfterSeconds: result[1],
        };
    }
  } catch {
    // Provider bodies, credentials and network errors are deliberately discarded.
  }
  return unavailable;
}

let healthCache:
  | {fingerprint: string; expiresAt: number; pending: Promise<boolean>}
  | undefined;

export async function rateLimiterReady(
  environment: ServerEnvironment = process.env,
): Promise<boolean> {
  const config = configuration(environment);
  if (config.backend !== 'redis') return config.backend === 'memory';
  const fingerprint = createHash('sha256')
    .update(`${config.endpoint}:${config.token}:${config.secret}`)
    .digest('hex');
  const now = Date.now();
  if (healthCache?.fingerprint === fingerprint && healthCache.expiresAt > now)
    return healthCache.pending;
  // Collapse concurrent monitor probes and cache briefly, without reading any
  // catalog, creating a cart, spending model tokens or returning infrastructure.
  const pending = redisCommand(config, ['PING'])
    .then((result) => result === 'PONG')
    .catch(() => false);
  healthCache = {fingerprint, expiresAt: now + 30_000, pending};
  return pending;
}
