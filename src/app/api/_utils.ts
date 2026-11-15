import {CommerceError} from '@/lib/shopify';
import {checkRateLimit} from '@/lib/rate-limit';
import {recordApiRequest, type ApiRoute} from '@/lib/observability';
import {
  appOrigin,
  isLoopbackOrigin,
  originConfigurationReady,
} from '@/lib/server-config';

export function assertAllowedOrigin(request: Request): void {
  if (!originConfigurationReady())
    throw new CommerceError(
      'The service is temporarily unavailable. Please try again.',
      503,
    );
  const configured = appOrigin();
  const target = new URL(request.url);
  // Only local development may use Host to correct Next's bind hostname.
  // Production compares against explicit configuration, never forwarded input.
  const host = request.headers.get('host');
  if (!configured && isLoopbackOrigin(target.origin) && host) {
    try {
      const candidate = new URL(`${target.protocol}//${host}`);
      if (
        isLoopbackOrigin(candidate.origin) &&
        candidate.pathname === '/' &&
        !candidate.username &&
        !candidate.password
      )
        target.host = candidate.host;
    } catch {
      throw new CommerceError('This request origin is not allowed.', 403);
    }
  }
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (
    (origin && origin !== (configured ?? target.origin)) ||
    site === 'cross-site' ||
    (request.method === 'POST' && !origin && site && site !== 'none')
  ) {
    throw new CommerceError('This request origin is not allowed.', 403);
  }
}

export async function handleApiRequest(
  route: ApiRoute,
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const startedAt = performance.now();
  let response: Response;
  try {
    if (route !== 'health') {
      assertAllowedOrigin(request);
      const limit = await checkRateLimit(route, request);
      if (!limit.allowed) {
        response = Response.json(
          {
            error:
              limit.reason === 'limited'
                ? 'Too many requests. Please wait and try again.'
                : 'The service is temporarily unavailable. Please try again.',
          },
          {
            status: limit.reason === 'limited' ? 429 : 503,
            headers: {'Retry-After': String(limit.retryAfterSeconds)},
          },
        );
      } else {
        response = await handler();
      }
    } else {
      response = await handler();
    }
  } catch (error) {
    response = errorResponse(error);
  }
  response.headers.set('Cache-Control', 'no-store');
  recordApiRequest(route, response.status, startedAt);
  return response;
}

export async function readJson(
  request: Request,
  maximumBytes = 8192,
): Promise<Record<string, unknown>> {
  assertAllowedOrigin(request);
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  ) {
    throw new CommerceError('Send a JSON request.', 415);
  }
  const statedLength = Number(request.headers.get('content-length') || 0);
  if (statedLength > maximumBytes)
    throw new CommerceError('The request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new CommerceError('The request body is required.', 400);
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new CommerceError('The request is too large.', 413);
      }
      text += decoder.decode(value, {stream: true});
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CommerceError('The request is not valid JSON.', 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new CommerceError('Send a JSON object.', 400);
  return parsed as Record<string, unknown>;
}

export function errorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof CommerceError
          ? error.message
          : 'The service is temporarily unavailable. Please try again.',
    },
    {
      status: error instanceof CommerceError ? error.status : 502,
      headers: {'Cache-Control': 'no-store'},
    },
  );
}
