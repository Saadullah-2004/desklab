import {CommerceError} from '@/lib/shopify';

export async function readJson(
  request: Request,
  maximumBytes = 8192,
): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  ) {
    throw new CommerceError('Send a JSON request.', 415);
  }
  const origin = request.headers.get('origin');
  const target = new URL(request.url);
  // Next can reconstruct request.url with its bind hostname. The HTTP Host
  // retains the origin used by the browser, including a non-default port.
  const host = request.headers.get('host');
  if (host) target.host = host;
  if (origin && origin !== target.origin)
    throw new CommerceError('This request origin is not allowed.', 403);
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
