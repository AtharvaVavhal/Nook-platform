import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { serverFailureMessage } from './errorReference.js';

const ID = '3f2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e6f';

test('only server failures get the friendly message, and it quotes the request id', () => {
  assert.equal(serverFailureMessage(400, ID), null);
  assert.equal(serverFailureMessage(404, ID), null);
  assert.equal(serverFailureMessage(499, ID), null);
  assert.equal(
    serverFailureMessage(500, ID),
    `Something went wrong on our side. Please try again. Reference: ${ID}`,
  );
  assert.match(String(serverFailureMessage(503, ID)), /Reference: /);
});

test('a missing or malformed reference is left out, never echoed', () => {
  for (const bad of [
    null,
    undefined,
    '',
    'not-an-id',
    '<script>alert(1)</script>',
    `${ID}\nextra`,
  ]) {
    const message = serverFailureMessage(500, bad);
    assert.equal(message, 'Something went wrong on our side. Please try again.');
  }
});

const realFetch = globalThis.fetch;
beforeEach(async () => {
  (globalThis as { window?: unknown }).window = new EventTarget();
  (await import('./apiConfig.js')).csrf.clear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { window?: unknown }).window;
});

test("the operations client shows the reference for a 500 and the server's own message for a 4xx", async () => {
  const { opsApi } = await import('./ops/opsApi.js');
  const respond = (status: number, body: unknown) =>
    (async (input: string | URL | Request) =>
      String(input).endsWith('/auth/csrf')
        ? Response.json({ data: { csrfToken: 't' } })
        : Response.json(body, { status, headers: { 'x-request-id': ID } })) as typeof fetch;

  globalThis.fetch = respond(500, {
    statusCode: 500,
    message: 'Internal server error',
    requestId: ID,
  });
  await assert.rejects(
    opsApi.enquiries.create({ firstName: 'A', lastName: 'B', phone: '9000000001' } as never),
    (error: Error) => {
      assert.match(error.message, new RegExp(`Reference: ${ID}`));
      assert.ok(!/Internal server error/.test(error.message));
      return true;
    },
  );
  globalThis.fetch = respond(400, { message: 'phone must be a phone number' });
  await assert.rejects(
    opsApi.enquiries.create({ firstName: 'A', lastName: 'B', phone: 'x' } as never),
    /phone must be a phone number/,
  );
});
