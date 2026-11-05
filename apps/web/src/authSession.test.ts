import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

// The browser globals the clients touch, scripted per test.
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
let handler: Handler;
const log: { url: string; method: string; csrf: string | null; credentials?: string }[] = [];
const events: string[] = [];
let tokenCounter = 0;

const realFetch = globalThis.fetch;
beforeEach(async () => {
  // each test starts with a fresh page load: nothing remembered in memory
  (await import('./apiConfig.js')).csrf.clear();
  log.length = 0;
  events.length = 0;
  tokenCounter = 0;
  const target = new EventTarget();
  (globalThis as { window?: unknown }).window = target;
  target.addEventListener('nook:unauthorized', () => events.push('unauthorized'));
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    log.push({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      csrf: new Headers(init.headers).get('x-csrf-token'),
      ...(init.credentials ? { credentials: init.credentials } : {}),
    });
    if (url.endsWith('/auth/csrf')) {
      tokenCounter += 1;
      return Response.json({ data: { csrfToken: `token-${tokenCounter}` } });
    }
    return handler(url, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { window?: unknown }).window;
});

const user = {
  id: 'u1',
  displayName: 'Owner',
  organization: { id: 'o1', name: 'Hostel' },
  role: 'OWNER',
  passwordChangeRequired: false,
};
const ok = () => Response.json({ data: { user } });
const writes = () => log.filter((c) => !c.url.endsWith('/auth/csrf'));

test("sign-in needs no token, and the next write after it uses the new session's token", async () => {
  const { authApi } = await import('./auth/authApi.js');
  const { opsApi } = await import('./ops/opsApi.js');
  handler = (url) => (url.endsWith('/auth/login') ? ok() : Response.json({ items: [] }));

  await opsApi.enquiries.create({ firstName: 'A', lastName: 'B', phone: '9000000001' } as never);
  assert.equal(writes()[0]!.csrf, 'token-1');

  await authApi.login('owner@example.in', 'a-long-enough-password');
  const login = log.find((c) => c.url.endsWith('/auth/login'))!;
  assert.equal(login.csrf, null, 'sign-in is not CSRF-protected and sends no token');
  assert.equal(login.credentials, 'include');

  await opsApi.enquiries.create({ firstName: 'A', lastName: 'B', phone: '9000000001' } as never);
  assert.equal(writes().at(-1)!.csrf, 'token-2', 'the token is refreshed after sign-in');
});

test('sign-out clears the token, so a later user never reuses it', async () => {
  const { authApi } = await import('./auth/authApi.js');
  const { opsApi } = await import('./ops/opsApi.js');
  handler = () => Response.json({ data: { loggedOut: true } });
  await authApi.logout();
  assert.equal(writes()[0]!.csrf, 'token-1');
  assert.equal(writes()[0]!.credentials, 'include');
  await opsApi.enquiries.create({ firstName: 'A', lastName: 'B', phone: '9000000001' } as never);
  assert.equal(writes().at(-1)!.csrf, 'token-2');
});

test('session expiry: a 401 on a write tells the app the session ended and drops the token', async () => {
  const { opsApi } = await import('./ops/opsApi.js');
  let first = true;
  handler = () => {
    if (first) {
      first = false;
      return Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    return Response.json({ id: 'e1' });
  };
  await assert.rejects(
    opsApi.enquiries.create({ firstName: 'A', lastName: 'B', phone: '9000000001' } as never),
    /session has ended/i,
  );
  assert.deepEqual(events, ['unauthorized']);
  assert.equal(writes()[0]!.csrf, 'token-1');
  // after signing in again the next write fetches the new session's token
  await opsApi.enquiries.create({ firstName: 'A', lastName: 'B', phone: '9000000001' } as never);
  assert.equal(writes().at(-1)!.csrf, 'token-2');
});

test('session expiry: /auth/me with an ended session is "signed out", not an error', async () => {
  const { authApi } = await import('./auth/authApi.js');
  handler = () => Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  assert.equal(await authApi.me(), null);
  assert.equal(log[0]!.credentials, 'include');
  assert.equal(log.filter((c) => c.url.endsWith('/auth/csrf')).length, 0, 'reads need no token');
});

test('a write refused for a stale token is retried transparently with the current one', async () => {
  const { opsApi } = await import('./ops/opsApi.js');
  let first = true;
  handler = () => {
    if (first) {
      first = false;
      return Response.json({ code: 'INVALID_CSRF_TOKEN' }, { status: 403 });
    }
    return Response.json({ id: 'e1' });
  };
  await opsApi.enquiries.create({ firstName: 'A', lastName: 'B', phone: '9000000001' } as never);
  assert.deepEqual(
    writes().map((c) => c.csrf),
    ['token-1', 'token-2'],
  );
});
