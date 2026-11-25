// Defect 4 regression: a new sign-in must never reuse the CSRF token of an earlier session.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient, type FetchLike } from './client.js';
import { createResidentApi } from './endpoints.js';

/** A faithful miniature of the real API's CSRF rules: the token lives in a cookie, GET /csrf returns the current cookie token
 *  (creating one if absent), every sign-in ROTATES it, and logout needs the header to equal the cookie. */
function server() {
  let cookieToken: string | null = null;
  let session = false;
  let n = 0;
  const calls: Array<{ path: string; status: number; header: string | null }> = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetchFn: FetchLike = async (url, init = {}) => {
    const path = url.replace('/api/v1', '');
    const headers = (init.headers ?? {}) as Record<string, string>;
    const header = headers['X-CSRF-Token'] ?? null;
    let res: Response;
    if (path === '/resident-auth/csrf') {
      cookieToken ??= `token-${(n += 1)}`;
      res = json(200, { data: { csrfToken: cookieToken } });
    } else if (path === '/resident-auth/otp/verify') {
      cookieToken = `token-${(n += 1)}`;
      session = true;
      res = json(200, { data: { authenticated: true } });
    } else if (path === '/resident-auth/logout') {
      res =
        session && header !== null && header === cookieToken
          ? json(200, { data: { loggedOut: true } })
          : json(403, { code: 'INVALID_CSRF_TOKEN' });
      if (res.status === 200) {
        session = false;
        cookieToken = null;
      }
    } else res = json(404, {});
    calls.push({ path, status: res.status, header });
    return res;
  };
  const api = createResidentApi(createApiClient({ baseUrl: '/api/v1', fetchFn }));
  return { api, calls };
}

test("signing in twice in one tab: the second sign-out sends the second session's token on the first attempt", async () => {
  const { api, calls } = server();
  await api.verifyOtp('+919876543210', '123456');
  await api.logout();
  await api.verifyOtp('+919876543210', '123456');
  await api.logout();
  const logouts = calls.filter((c) => c.path === '/resident-auth/logout');
  assert.equal(
    logouts.length,
    2,
    `one logout request per sign-out, got ${JSON.stringify(logouts)}`,
  );
  assert.deepEqual(
    logouts.map((l) => l.status),
    [200, 200],
  );
  assert.notEqual(
    logouts[0]?.header,
    logouts[1]?.header,
    'the second session uses a different token',
  );
  assert.equal(calls.filter((c) => c.status === 403).length, 0, 'no CSRF refusal');
});

test('a token is fetched again after every sign-in and after sign-out (never carried across sessions)', async () => {
  const { api, calls } = server();
  for (let i = 0; i < 3; i += 1) {
    await api.verifyOtp('+919876543210', '123456');
    await api.logout();
  }
  assert.equal(
    calls.filter((c) => c.path === '/resident-auth/csrf').length,
    3,
    'one fresh token per session',
  );
  assert.equal(calls.filter((c) => c.status === 403).length, 0);
});

test('CSRF protection is intact: a logout without a valid token is still refused', async () => {
  const { api } = server();
  await assert.rejects(api.logout(), (e: { kind?: string }) => e.kind === 'forbidden');
});
