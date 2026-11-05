import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { checkApiBase } from './apiBaseCheck.js';
import { CSRF_HEADER, createCsrfClient, type FetchLike } from './csrf.js';

const BASE = 'https://api.example.test/api/v1';

interface Call {
  url: string;
  method: string;
  credentials: string | undefined;
  csrf: string | null;
  body: unknown;
}

/** A scripted API: records every call, serves GET /auth/csrf, and answers other requests from a queue. */
function fakeApi(
  opts: { tokens?: string[]; answers?: Array<() => Response>; csrfStatus?: number } = {},
) {
  const calls: Call[] = [];
  const tokens = [...(opts.tokens ?? ['token-1', 'token-2', 'token-3'])];
  const answers = [...(opts.answers ?? [])];
  const fetchFn: FetchLike = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    calls.push({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      credentials: init.credentials,
      csrf: headers.get(CSRF_HEADER),
      body: init.body,
    });
    if (url === `${BASE}/auth/csrf`) {
      if (opts.csrfStatus && opts.csrfStatus !== 200)
        return new Response('{}', { status: opts.csrfStatus });
      return Response.json({ data: { csrfToken: tokens.shift() ?? 'exhausted' } });
    }
    return (answers.shift() ?? (() => Response.json({ ok: true })))();
  };
  return {
    calls,
    fetchFn,
    csrfFetches: () => calls.filter((c) => c.url.endsWith('/auth/csrf')).length,
  };
}

const csrfRefusal = () => Response.json({ code: 'INVALID_CSRF_TOKEN' }, { status: 403 });

test('GET requests never fetch or send a CSRF token, and always include credentials', async () => {
  const api = fakeApi();
  const client = createCsrfClient(BASE, api.fetchFn);
  await client.request(`${BASE}/residents`);
  await client.request(`${BASE}/residents`, { method: 'GET' });
  assert.equal(api.csrfFetches(), 0);
  assert.ok(api.calls.every((c) => c.credentials === 'include' && c.csrf === null));
});

test('POST, PUT, PATCH and DELETE each carry the token in X-CSRF-Token with credentials included', async () => {
  const api = fakeApi();
  const client = createCsrfClient(BASE, api.fetchFn);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'patch']) {
    await client.request(`${BASE}/things`, { method, body: '{}' });
  }
  const writes = api.calls.filter((c) => !c.url.endsWith('/auth/csrf'));
  assert.equal(writes.length, 6);
  for (const call of writes) {
    assert.equal(call.csrf, 'token-1', `${call.method} must carry the token`);
    assert.equal(call.credentials, 'include');
  }
  assert.equal(api.csrfFetches(), 1, 'the token is fetched once and kept in memory');
  const fetchCall = api.calls.find((c) => c.url.endsWith('/auth/csrf'))!;
  assert.equal(fetchCall.credentials, 'include', 'the token request itself sends the cookie');
  assert.equal(fetchCall.method, 'GET');
});

test('existing headers are preserved next to the token', async () => {
  const seen: Headers[] = [];
  const client = createCsrfClient(BASE, async (url, init) => {
    if (url.endsWith('/auth/csrf')) return Response.json({ data: { csrfToken: 't' } });
    seen.push(new Headers(init?.headers));
    return Response.json({});
  });
  await client.request(`${BASE}/x`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'abc' },
  });
  assert.equal(seen[0]!.get('content-type'), 'application/json');
  assert.equal(seen[0]!.get('idempotency-key'), 'abc');
  assert.equal(seen[0]!.get('x-csrf-token'), 't');
});

test('concurrent first writes share a single token request', async () => {
  const api = fakeApi();
  const client = createCsrfClient(BASE, api.fetchFn);
  await Promise.all([1, 2, 3, 4].map(() => client.request(`${BASE}/x`, { method: 'POST' })));
  assert.equal(api.csrfFetches(), 1);
});

test("clear() (sign-in, sign-out, 401) makes the next write fetch the new session's token", async () => {
  const api = fakeApi();
  const client = createCsrfClient(BASE, api.fetchFn);
  await client.request(`${BASE}/x`, { method: 'POST' });
  client.clear();
  await client.request(`${BASE}/x`, { method: 'POST' });
  const writes = api.calls.filter((c) => !c.url.endsWith('/auth/csrf'));
  assert.deepEqual(
    writes.map((c) => c.csrf),
    ['token-1', 'token-2'],
  );
  assert.equal(api.csrfFetches(), 2);
});

test('a token request that was in flight when the session changed does not repopulate the cache', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let served = 0;
  const client = createCsrfClient(BASE, async (url) => {
    if (url.endsWith('/auth/csrf')) {
      served += 1;
      const mine = served;
      if (mine === 1) await gate; // the first (old-session) answer arrives late
      return Response.json({ data: { csrfToken: `token-${mine}` } });
    }
    return Response.json({});
  });
  const first = client.token();
  client.clear(); // sign-in happened meanwhile
  release();
  await first;
  assert.equal(await client.token(), 'token-2', 'the stale answer was not kept');
});

test('a write refused for a stale token is retried once with a fresh token, and only once', async () => {
  const api = fakeApi({ answers: [csrfRefusal, () => Response.json({ saved: true })] });
  const client = createCsrfClient(BASE, api.fetchFn);
  const res = await client.request(`${BASE}/x`, { method: 'PUT', body: '{"a":1}' });
  assert.equal(res.status, 200);
  const writes = api.calls.filter((c) => !c.url.endsWith('/auth/csrf'));
  assert.deepEqual(
    writes.map((c) => c.csrf),
    ['token-1', 'token-2'],
  );
  assert.equal(writes[1]!.body, '{"a":1}', 'the retry sends the same body');

  const stubborn = fakeApi({ answers: [csrfRefusal, csrfRefusal, () => Response.json({})] });
  const again = await createCsrfClient(BASE, stubborn.fetchFn).request(`${BASE}/x`, {
    method: 'POST',
  });
  assert.equal(again.status, 403, 'a second refusal is returned, not retried forever');
  assert.equal(stubborn.calls.filter((c) => !c.url.endsWith('/auth/csrf')).length, 2);
});

test('other 403s (for example a refused Origin) and 401s are returned as they are, never retried', async () => {
  const origin = fakeApi({
    answers: [() => Response.json({ code: 'INVALID_ORIGIN' }, { status: 403 })],
  });
  assert.equal(
    (await createCsrfClient(BASE, origin.fetchFn).request(`${BASE}/x`, { method: 'POST' })).status,
    403,
  );
  assert.equal(origin.calls.filter((c) => !c.url.endsWith('/auth/csrf')).length, 1);

  const expired = fakeApi({
    answers: [() => Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 })],
  });
  assert.equal(
    (await createCsrfClient(BASE, expired.fetchFn).request(`${BASE}/x`, { method: 'DELETE' }))
      .status,
    401,
  );
  assert.equal(expired.calls.filter((c) => !c.url.endsWith('/auth/csrf')).length, 1);

  const text = fakeApi({ answers: [() => new Response('forbidden', { status: 403 })] });
  assert.equal(
    (await createCsrfClient(BASE, text.fetchFn).request(`${BASE}/x`, { method: 'POST' })).status,
    403,
  );
});

test('a failed token request rejects the write, is not cached, and the next write tries again', async () => {
  let fail = true;
  let attempts = 0;
  const client = createCsrfClient(BASE, async (url) => {
    if (url.endsWith('/auth/csrf')) {
      attempts += 1;
      return fail
        ? new Response('{}', { status: 500 })
        : Response.json({ data: { csrfToken: 'ok' } });
    }
    return Response.json({});
  });
  await assert.rejects(client.request(`${BASE}/x`, { method: 'POST' }), /CSRF token/);
  fail = false;
  assert.equal((await client.request(`${BASE}/x`, { method: 'POST' })).status, 200);
  assert.equal(attempts, 2);
  const bad = createCsrfClient(BASE, async () => Response.json({ data: {} }));
  await assert.rejects(bad.token(), /no CSRF token/);
});

test('the application never stores the token or any cookie in the browser: no web storage, no document.cookie', () => {
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) {
        const code = stripComments(readFileSync(path, 'utf8'));
        if (/localStorage|sessionStorage|document\.cookie|indexedDB/.test(code))
          offenders.push(path);
      }
    }
  };
  walk(new URL('.', import.meta.url).pathname);
  assert.deepEqual(offenders, []);
});

test('no API module calls fetch directly for a write: all go through the CSRF client', () => {
  for (const file of ['api.ts', 'ops/opsApi.ts', 'finance/financeApi.ts']) {
    const code = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /\bfetch\(/, `${file} must use csrf.request`);
    assert.match(code, /csrf\.request\(/, `${file} must use csrf.request`);
  }
  const auth = readFileSync(new URL('./auth/authApi.ts', import.meta.url), 'utf8');
  assert.equal(
    (auth.match(/\bfetch\(/g) ?? []).length,
    1,
    'only the unauthenticated sign-in call uses fetch directly',
  );
});

test('production builds require an absolute https VITE_API_BASE; development is untouched', () => {
  assert.equal(checkApiBase('development', undefined), null);
  assert.equal(checkApiBase('development', '/api/v1'), null);
  assert.equal(checkApiBase('production', 'https://api.trynook.in/api/v1'), null);
  assert.match(String(checkApiBase('production', undefined)), /VITE_API_BASE is not set/);
  assert.throws(() => checkApiBase('production', '/api/v1'), /absolute URL/);
  assert.throws(() => checkApiBase('production', 'http://api.trynook.in/api/v1'), /https/);
});
