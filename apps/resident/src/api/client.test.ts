import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient, type FetchLike } from './client.js';
import { ApiError } from './errors.js';
import { createResidentApi } from './endpoints.js';

interface Call {
  url: string;
  init: RequestInit;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function harness(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init = {}) => {
    const call = { url, init };
    calls.push(call);
    return handler(call, calls.length);
  };
  let unauthorized = 0;
  const client = createApiClient({
    baseUrl: '/api/v1',
    fetchFn,
    onUnauthorized: () => {
      unauthorized += 1;
    },
  });
  return { calls, client, api: createResidentApi(client), unauthorizedCount: () => unauthorized };
}

test('reads unwrap {data}, send cookies, never cache, and send no resident or organization id', async () => {
  const h = harness(() => json(200, { data: { displayName: 'Asha Example' } }));
  const profile = await h.api.profile();
  assert.equal(profile.displayName, 'Asha Example');
  const call = h.calls[0]!;
  assert.equal(call.url, '/api/v1/me');
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.credentials, 'include');
  assert.equal(call.init.cache, 'no-store');
  assert.equal(
    (call.init.headers as Record<string, string>)['X-CSRF-Token'],
    undefined,
    'reads carry no CSRF token',
  );
  assert.equal(call.init.body, undefined);
});

test('requests carry only what the API needs: the number and code at sign-in, page and limit for lists, an id in the path', async () => {
  const h = harness((c) =>
    c.url.endsWith('/csrf')
      ? json(200, { data: { csrfToken: 't1' } })
      : json(200, {
          data: { items: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0 } },
        }),
  );
  await h.api.invoices(2, 5);
  await h.api.payments(1, 20);
  await h.api.invoice('123e4567-e89b-42d3-a456-426614174000');
  assert.deepEqual(
    h.calls.map((c) => c.url),
    [
      '/api/v1/me/invoices?page=2&limit=5',
      '/api/v1/me/payments?page=1&limit=20',
      '/api/v1/me/invoices/123e4567-e89b-42d3-a456-426614174000',
    ],
  );
  for (const c of h.calls)
    assert.ok(!/residentId|organizationId|accountId/i.test(c.url + String(c.init.body ?? '')));
});

test('sign-in requests send only the phone and code, need no CSRF token, and a 401 there is not "session ended"', async () => {
  const h = harness((c) =>
    c.url.endsWith('/otp/verify')
      ? json(401, { code: 'INVALID_OR_EXPIRED_CODE' })
      : json(200, { data: { requested: true, resendAfterSeconds: 30 } }),
  );
  const requested = await h.api.requestOtp('+919876543210');
  assert.deepEqual(requested, { requested: true, resendAfterSeconds: 30 });
  assert.deepEqual(JSON.parse(String(h.calls[0]!.init.body)), { phone: '+919876543210' });
  await assert.rejects(
    h.api.verifyOtp('+919876543210', '123456'),
    (e: ApiError) => e.kind === 'unauthorized' && e.code === 'INVALID_OR_EXPIRED_CODE',
  );
  assert.deepEqual(JSON.parse(String(h.calls[1]!.init.body)), {
    phone: '+919876543210',
    code: '123456',
  });
  assert.equal(h.unauthorizedCount(), 0, 'a wrong code is not an ended session');
  assert.equal(
    h.calls.some((c) => c.url.endsWith('/csrf')),
    false,
    'no CSRF fetch for sign-in',
  );
});

test('sign-out fetches the resident CSRF token once, sends it, and does not touch the owner endpoints', async () => {
  const h = harness((c) =>
    c.url.endsWith('/resident-auth/csrf')
      ? json(200, { data: { csrfToken: 'tok-1' } })
      : json(200, { data: { loggedOut: true } }),
  );
  assert.deepEqual(await h.api.logout(), { loggedOut: true });
  assert.equal(h.calls[0]!.url, '/api/v1/resident-auth/csrf');
  const logout = h.calls[1]!;
  assert.equal(logout.url, '/api/v1/resident-auth/logout');
  assert.equal(logout.init.method, 'POST');
  assert.equal((logout.init.headers as Record<string, string>)['X-CSRF-Token'], 'tok-1');
  assert.ok(h.calls.every((c) => !c.url.includes('/auth/csrf') && !c.url.includes('/auth/login')));
});

test('a stale CSRF token is retried once with a fresh one, then the refusal is reported', async () => {
  let token = 0;
  const h = harness((c) => {
    if (c.url.endsWith('/csrf')) return json(200, { data: { csrfToken: `tok-${++token}` } });
    return (c.init.headers as Record<string, string>)['X-CSRF-Token'] === 'tok-2'
      ? json(200, { data: { loggedOut: true } })
      : json(403, { code: 'INVALID_CSRF_TOKEN' });
  });
  assert.deepEqual(await h.api.logout(), { loggedOut: true });
  assert.equal(h.calls.filter((c) => c.url.endsWith('/logout')).length, 2);

  const always = harness((c) =>
    c.url.endsWith('/csrf')
      ? json(200, { data: { csrfToken: 'x' } })
      : json(403, { code: 'INVALID_CSRF_TOKEN' }),
  );
  await assert.rejects(always.api.logout(), (e: ApiError) => e.kind === 'forbidden');
  assert.equal(
    always.calls.filter((c) => c.url.endsWith('/logout')).length,
    2,
    'exactly one retry',
  );
});

test('every failure becomes a typed error: unauthorized, rate limited, not found, bad request, server, network, odd bodies', async () => {
  const cases: Array<[Response | Error, string, string | null, number | null]> = [
    [json(401, { code: 'UNAUTHENTICATED' }), 'unauthorized', 'UNAUTHENTICATED', null],
    [
      json(429, { code: 'OTP_RATE_LIMITED', retryAfterSeconds: 42 }),
      'rateLimited',
      'OTP_RATE_LIMITED',
      42,
    ],
    [json(404, { code: 'NOT_FOUND' }), 'notFound', 'NOT_FOUND', null],
    [json(404, { statusCode: 404, message: 'Not Found' }), 'notFound', null, null],
    [json(400, { code: 'INVALID_PHONE_NUMBER' }), 'badRequest', 'INVALID_PHONE_NUMBER', null],
    [json(403, { code: 'INSUFFICIENT_ROLE' }), 'forbidden', 'INSUFFICIENT_ROLE', null],
    [json(500, { message: 'Internal server error' }), 'server', null, null],
    [new Response('<html>Bad gateway</html>', { status: 502 }), 'server', null, null],
    [new Response('not json', { status: 200 }), 'unexpected', null, null],
    [json(200, { nothing: true }), 'unexpected', null, null],
    [new TypeError('Failed to fetch'), 'network', null, null],
  ];
  for (const [outcome, kind, code, retry] of cases) {
    const h = harness(() => {
      if (outcome instanceof Error) throw outcome;
      return outcome.clone();
    });
    await assert.rejects(
      h.api.profile(),
      (e: ApiError) => e.kind === kind && e.code === code && e.retryAfterSeconds === retry,
      `${kind} ${code}`,
    );
  }
});

test('a 401 on a signed-in request ends the session exactly once per request; an aborted request is not an error state', async () => {
  const h = harness(() => json(401, { code: 'UNAUTHENTICATED' }));
  await assert.rejects(h.api.stay());
  await assert.rejects(h.api.rentSummary());
  assert.equal(h.unauthorizedCount(), 2);
  const ctrl = new AbortController();
  const aborting = harness(() => {
    ctrl.abort();
    throw new DOMException('aborted', 'AbortError');
  });
  await assert.rejects(aborting.api.profile(ctrl.signal), (e: unknown) => !(e instanceof ApiError));
});

test('this app calls only the documented endpoints: no payment, edit, registration, owner or staff call exists', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(p);
    }
  };
  walk(root);
  // Comments are documentation, not behaviour: only code and string literals are scanned.
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const source = files.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
  const paths = new Set(
    [...source.matchAll(/(?:['`]|\})\/((?:me|resident-auth)[^'`$?]*)/g)].map((m) => `/${m[1]}`),
  );
  assert.deepEqual(
    [...paths].sort(),
    [
      '/me',
      '/me/invoices',
      '/me/invoices/',
      '/me/payments',
      '/me/receipts/',
      '/me/rent-summary',
      '/me/stay',
      '/resident-auth/csrf',
      '/resident-auth/logout',
      '/resident-auth/otp/request',
      '/resident-auth/otp/verify',
    ].sort(),
  );
  const methods = [...source.matchAll(/client\.(post|put|patch|delete)</g)].map((m) => m[1]);
  assert.deepEqual(methods.sort(), ['post', 'post', 'post']);
  for (const banned of [
    'razorpay',
    'checkout',
    '/finance',
    '/auth/login',
    '/residents',
    'register',
    'signup',
    'password',
    'staff login',
    'localStorage',
    'sessionStorage',
    'document.cookie',
  ])
    assert.equal(
      new RegExp(
        `(?<![A-Za-z])${banned.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![A-Za-z])`,
        'i',
      ).test(source),
      false,
      `source must not contain "${banned}"`,
    );
});
