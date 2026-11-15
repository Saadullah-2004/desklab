import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readJson, errorResponse} from '../src/app/api/_utils';
import {CommerceError} from '../src/lib/shopify';

const url = 'https://desklab.example/api/checkout';

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
