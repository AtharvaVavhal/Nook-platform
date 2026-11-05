/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { loadRuntimeConfig } from '../../src/config.js';
import { withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// The production wiring, exercised for real: the API and the web app on different origins, TLS ended by a proxy
// in front of the API (so requests reach the process over plain HTTP), one proxy hop, credentialed CORS for one
// exact origin. configureApp is the same function main.ts runs.
const WEB_ORIGIN = 'https://app.example.test';
process.env.APP_ENV = 'production';
process.env.WEB_ORIGIN = WEB_ORIGIN;
process.env.TRUST_PROXY_HOPS = '1';
requireTestDatabaseUrl();

let app: any;
let server: ReturnType<typeof request>;
let passwordHash: string;

const randomAddress = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

interface Account {
  email: string;
  orgId: string;
  userId: string;
  propertyId: string;
}

async function newAccount(): Promise<Account> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const propertyId = randomUUID();
  const email = `xo-${randomUUID()}@nook.test.invalid`;
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
      orgId,
      `Cross Origin ${orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'XO Tester',now())`,
      [userId, email, passwordHash],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'OWNER','ACTIVE')`,
      [randomUUID(), orgId, userId],
    );
    await c.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'P',now())`,
      [propertyId, orgId, `P-${propertyId.slice(0, 8)}`],
    );
    await c.query('COMMIT');
  });
  return { email, orgId, userId, propertyId };
}

interface Session {
  cookies: string[]; // raw Set-Cookie lines
  session: string; // "nook_session=..."
  csrfCookie: string; // "nook_csrf=..."
  token: string; // the CSRF token as the web app receives it (GET /auth/csrf body)
  cookieHeader: string;
}

const attr = (lines: string[], name: string) => lines.find((l) => l.startsWith(`${name}=`))!;

/** Signs in the way the browser client does: Origin set, then the CSRF token read from the body of GET /auth/csrf. */
async function signIn(account: Account, address = randomAddress()): Promise<Session> {
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', WEB_ORIGIN)
    .set('X-Forwarded-For', address)
    .send({ email: account.email, password: TEST_PASSWORD })
    .expect(200);
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const session = attr(cookies, 'nook_session').split(';')[0]!;
  const csrfCookie = attr(cookies, 'nook_csrf').split(';')[0]!;
  const cookieHeader = `${session}; ${csrfCookie}`;
  const tokenRes = await server
    .get('/api/v1/auth/csrf')
    .set('Origin', WEB_ORIGIN)
    .set('Cookie', cookieHeader)
    .expect(200);
  return { cookies, session, csrfCookie, token: tokenRes.body.data.csrfToken, cookieHeader };
}

const write = (
  method: 'post' | 'put' | 'patch' | 'delete',
  s: Session | null,
  path: string,
  body: object | undefined,
  token: string | null | undefined = s?.token,
) => {
  let r = (server as any)[method](`/api/v1${path}`).set('Origin', WEB_ORIGIN);
  if (s) r = r.set('Cookie', s.cookieHeader);
  if (token) r = r.set('X-CSRF-Token', token);
  return body === undefined ? r : r.send(body);
};

test.before(async () => {
  passwordHash = await hashTestPassword();
  app = await NestFactory.create(AppModule, { abortOnError: true });
  configureApp(app, loadRuntimeConfig());
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${app.getHttpServer().address().port}`);
});

test.after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------- cookies

test('cookies: host-only (no Domain), HttpOnly, Secure and SameSite=Strict, even though TLS ends at the proxy', async () => {
  const account = await newAccount();
  const s = await signIn(account);
  for (const name of ['nook_session', 'nook_csrf']) {
    const line = attr(s.cookies, name);
    assert.match(line, /; HttpOnly/i, `${name} must be HttpOnly`);
    assert.match(line, /; Secure/i, `${name} must be Secure`);
    assert.match(line, /; SameSite=Strict/i, `${name} must be SameSite=Strict`);
    assert.match(line, /; Path=\//i);
    assert.doesNotMatch(line, /;\s*Domain=/i, `${name} must not carry a Domain (host-only)`);
  }
  // the cookie that GET /auth/csrf sets is held to the same rules
  const again = await server
    .get('/api/v1/auth/csrf')
    .set('Origin', WEB_ORIGIN)
    .set('X-Forwarded-For', randomAddress());
  const line = attr(again.headers['set-cookie'] as unknown as string[], 'nook_csrf');
  assert.match(line, /; HttpOnly/i);
  assert.match(line, /; Secure/i);
  assert.match(line, /; SameSite=Strict/i);
  assert.doesNotMatch(line, /;\s*Domain=/i);
});

// ---------------------------------------------------------------------------- CORS

test('cors: the exact web origin is allowed with credentials, never a wildcard, and 401s are readable', async () => {
  const res = await server.get('/api/v1/auth/me').set('Origin', WEB_ORIGIN).expect(401);
  assert.equal(res.headers['access-control-allow-origin'], WEB_ORIGIN);
  assert.equal(res.headers['access-control-allow-credentials'], 'true');
  assert.match(String(res.headers.vary), /Origin/i);

  const csrf = await server.get('/api/v1/auth/csrf').set('Origin', WEB_ORIGIN).expect(200);
  assert.equal(csrf.headers['access-control-allow-origin'], WEB_ORIGIN);
  assert.equal(csrf.headers['access-control-allow-credentials'], 'true');
  assert.match(String(csrf.headers['cache-control']), /no-store/);
});

test('cors: other origins get no CORS headers at all', async () => {
  for (const origin of [
    'https://evil.example.test',
    'https://app.example.test.evil.test',
    'http://app.example.test',
    'https://app.example.test:8443',
    'null',
  ]) {
    const res = await server.get('/api/v1/auth/me').set('Origin', origin);
    assert.equal(res.headers['access-control-allow-origin'], undefined, origin);
    assert.equal(res.headers['access-control-allow-credentials'], undefined, origin);
    const pre = await server
      .options('/api/v1/enquiries')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    assert.equal(pre.headers['access-control-allow-origin'], undefined, `preflight ${origin}`);
  }
});

test('cors: the preflight allows every write method and the CSRF header, nothing else', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const pre = await server
      .options('/api/v1/enquiries/x')
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', method)
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    assert.equal(pre.status, 204, `${method} preflight answered ${pre.status}`);
    assert.equal(pre.headers['access-control-allow-origin'], WEB_ORIGIN);
    assert.equal(pre.headers['access-control-allow-credentials'], 'true');
    const methods = String(pre.headers['access-control-allow-methods']).split(',');
    assert.ok(methods.includes(method), `${method} missing from ${methods}`);
    const headers = String(pre.headers['access-control-allow-headers']).toLowerCase();
    assert.ok(headers.includes('x-csrf-token') && headers.includes('content-type'), headers);
    assert.ok(Number(pre.headers['access-control-max-age']) > 0);
  }
  const odd = await server
    .options('/api/v1/enquiries')
    .set('Origin', WEB_ORIGIN)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'x-evil-header');
  assert.doesNotMatch(String(odd.headers['access-control-allow-headers']), /x-evil-header/i);
});

// ---------------------------------------------------------------------------- CSRF token retrieval

test('csrf: the token comes in the body, is stable for a cookie, and a cookie-less caller gets a fresh one', async () => {
  const a = await server.get('/api/v1/auth/csrf').set('Origin', WEB_ORIGIN).expect(200);
  const b = await server.get('/api/v1/auth/csrf').set('Origin', WEB_ORIGIN).expect(200);
  assert.ok(a.body.data.csrfToken.length >= 32);
  assert.notEqual(
    a.body.data.csrfToken,
    b.body.data.csrfToken,
    'no cookie sent -> a new token each time',
  );
  const cookie = `nook_csrf=${a.body.data.csrfToken}`;
  const again = await server
    .get('/api/v1/auth/csrf')
    .set('Origin', WEB_ORIGIN)
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(again.body.data.csrfToken, a.body.data.csrfToken, 'same cookie -> same token');
});

// ---------------------------------------------------------------------------- state-changing methods

test('writes: POST, PUT, PATCH and DELETE succeed with the session cookie and the token from the body', async () => {
  const account = await newAccount();
  const s = await signIn(account);
  assert.equal(
    s.token,
    s.csrfCookie.slice('nook_csrf='.length),
    'the body token is the cookie value (double submit)',
  );
  const created = await write('post', s, '/enquiries', {
    firstName: 'Asha',
    lastName: 'Rao',
    phone: '9000000011',
  }).expect(201);
  const id = created.body.id as string;
  await write('put', s, `/enquiries/${id}`, { notes: 'called' }).expect(200);
  await write('patch', s, `/properties/${account.propertyId}`, { name: 'Renamed' }).expect(200);
  await write('delete', s, `/enquiries/${id}`, undefined).expect(200);
});

test('writes: a missing, empty, wrong or foreign CSRF token is refused with 403 INVALID_CSRF_TOKEN for every method', async () => {
  const account = await newAccount();
  const s = await signIn(account);
  const other = await signIn(await newAccount());
  const e = await write('post', s, '/enquiries', {
    firstName: 'Asha',
    lastName: 'Rao',
    phone: '9000000012',
  }).expect(201);
  const targets: ['post' | 'put' | 'patch' | 'delete', string, object | undefined][] = [
    ['post', '/enquiries', { firstName: 'X', lastName: 'Y', phone: '9000000013' }],
    ['put', `/enquiries/${e.body.id}`, { notes: 'x' }],
    ['patch', `/properties/${account.propertyId}`, { name: 'Nope' }],
    ['delete', `/enquiries/${e.body.id}`, undefined],
  ];
  const bad: [string, string | null][] = [
    ['no header', null],
    ['empty header', ''],
    ['wrong value', 'not-the-token'],
    ["another session's token", other.token],
    [
      'same length, one character off',
      `${s.token.slice(0, -1)}${s.token.endsWith('A') ? 'B' : 'A'}`,
    ],
  ];
  for (const [method, path, body] of targets) {
    for (const [label, token] of bad) {
      const res = await write(method, s, path, body, token);
      assert.equal(res.status, 403, `${method} ${path} with ${label} answered ${res.status}`);
      assert.equal(res.body.code, 'INVALID_CSRF_TOKEN', `${method} with ${label}`);
    }
    // header without the cookie, and cookie without the header
    const agent: any = server;
    const noCookie = agent[method](`/api/v1${path}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', s.session)
      .set('X-CSRF-Token', s.token);
    const res = await (body === undefined ? noCookie : noCookie.send(body));
    assert.equal(res.status, 403, `${method} header-only answered ${res.status}`);
  }
  // nothing was changed by any refused request
  const after = await withMigratorClient((c) =>
    c.query(`SELECT status, notes FROM enquiries WHERE id = $1`, [e.body.id]),
  );
  assert.equal(after.rows[0].status, 'NEW');
  assert.equal(after.rows[0].notes, null);
});

test('writes: a wrong Origin is refused even with a valid session and token, and no session beats a valid token with 401', async () => {
  const s = await signIn(await newAccount());
  const res = await server
    .post('/api/v1/enquiries')
    .set('Origin', 'https://evil.example.test')
    .set('Cookie', s.cookieHeader)
    .set('X-CSRF-Token', s.token)
    .send({ firstName: 'A', lastName: 'B', phone: '9000000014' });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'INVALID_ORIGIN');
  const anonymous = await write('post', null, '/enquiries', { firstName: 'A' }, s.token);
  assert.equal(anonymous.status, 401);
});

// ---------------------------------------------------------------------------- refresh after session changes

test('csrf refresh: every sign-in rotates the token, and the previous token stops working', async () => {
  const account = await newAccount();
  const first = await signIn(account);
  const second = await signIn(account);
  assert.notEqual(first.token, second.token, 'a new sign-in issues a new CSRF token');
  assert.notEqual(first.session, second.session, 'and a new session');
  const body = { firstName: 'A', lastName: 'B', phone: '9000000015' };
  // old token with the new cookie pair: refused; new token with the new pair: accepted
  const stale = (server as any)
    .post('/api/v1/enquiries')
    .set('Origin', WEB_ORIGIN)
    .set('Cookie', second.cookieHeader)
    .set('X-CSRF-Token', first.token);
  assert.equal((await stale.send(body)).status, 403);
  await write('post', second, '/enquiries', body).expect(201);
});

test('csrf refresh: logout ends the session and clears both cookies; the next token belongs to the next sign-in', async () => {
  const account = await newAccount();
  const s = await signIn(account);
  const out = await write('post', s, '/auth/logout', undefined).expect(200);
  const cleared = out.headers['set-cookie'] as unknown as string[];
  for (const name of ['nook_session', 'nook_csrf']) {
    assert.match(attr(cleared, name), /Expires=Thu, 01 Jan 1970/i, `${name} must be cleared`);
  }
  // the old session no longer works, and neither does its token with a new session
  await server.get('/api/v1/auth/me').set('Cookie', s.cookieHeader).expect(401);
  const next = await signIn(account);
  assert.notEqual(next.token, s.token);
  assert.equal(
    (
      await write(
        'post',
        { ...next, cookieHeader: `${next.session}; ${next.csrfCookie}` },
        '/enquiries',
        {
          firstName: 'A',
          lastName: 'B',
          phone: '9000000016',
        },
        s.token,
      )
    ).status,
    403,
    "the previous session's token is useless in the new session",
  );
});

test('csrf refresh: a password change keeps the session and the token valid, and ends the other sessions', async () => {
  const account = await newAccount();
  const here = await signIn(account);
  const elsewhere = await signIn(account);
  const NEW_PASSWORD = `${TEST_PASSWORD}-changed-1`;
  await write('post', here, '/auth/password', {
    currentPassword: TEST_PASSWORD,
    newPassword: NEW_PASSWORD,
  }).expect(200);
  await server.get('/api/v1/auth/me').set('Cookie', here.cookieHeader).expect(200);
  await server.get('/api/v1/auth/me').set('Cookie', elsewhere.cookieHeader).expect(401);
  await write('post', here, '/enquiries', {
    firstName: 'A',
    lastName: 'B',
    phone: '9000000017',
  }).expect(201);
});

// ---------------------------------------------------------------------------- session expiry

test('session expiry: an idle or absolute expiry ends the session on reads and writes alike (401, not 403)', async () => {
  for (const column of ['idle_expires_at', 'absolute_expires_at']) {
    const account = await newAccount();
    const s = await signIn(account);
    await server.get('/api/v1/auth/me').set('Cookie', s.cookieHeader).expect(200);
    await withMigratorClient((c) =>
      c.query(`UPDATE sessions SET ${column} = now() - interval '1 minute' WHERE user_id = $1`, [
        account.userId,
      ]),
    );
    const me = await server
      .get('/api/v1/auth/me')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', s.cookieHeader);
    assert.equal(me.status, 401, column);
    assert.equal(
      me.headers['access-control-allow-origin'],
      WEB_ORIGIN,
      'the browser can read the 401',
    );
    const put = await write('post', s, '/enquiries', {
      firstName: 'A',
      lastName: 'B',
      phone: '9000000018',
    });
    assert.equal(put.status, 401, `${column}: a write after expiry answered ${put.status}`);
    // signing in again works and issues a fresh token
    const fresh = await signIn(account);
    assert.notEqual(fresh.token, s.token);
    await write('post', fresh, '/enquiries', {
      firstName: 'A',
      lastName: 'B',
      phone: '9000000019',
    }).expect(201);
  }
});

// ---------------------------------------------------------------------------- client address and throttling

test('throttling behind a proxy: the client address is the last X-Forwarded-For entry, so clients are throttled separately and cannot forge their way out', async () => {
  const account = await newAccount();
  const clientA = randomAddress();
  const clientB = randomAddress();
  const attempt = (address: string, header: string, email: string) =>
    server
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .set('X-Forwarded-For', header)
      .send({ email, password: 'definitely-wrong-password' });

  // client A fails 20 times against unknown accounts (so no real account is locked): the ADDRESS limit is 20
  for (let i = 0; i < 20; i += 1) {
    const res = await attempt(clientA, clientA, `nobody-${i}-${randomUUID()}@nook.test.invalid`);
    assert.equal(res.status, 401, `attempt ${i + 1} answered ${res.status}`);
  }
  const locked = await attempt(clientA, clientA, `nobody-${randomUUID()}@nook.test.invalid`);
  assert.equal(locked.status, 429, 'client A is locked after 20 failures');

  // forging a different leftmost address does not help: the proxy's own entry (the last one) is what counts
  const forged = await attempt(
    clientA,
    `203.0.113.250, ${clientA}`,
    `nobody-${randomUUID()}@nook.test.invalid`,
  );
  assert.equal(forged.status, 429, 'a forged leftmost address does not reset the lock');

  // client B is unaffected, and can sign in
  const ok = await signIn(account, clientB);
  assert.ok(ok.token);
  // and the lock is keyed by a hash, never the address itself
  const rows = await withMigratorClient((c) =>
    c.query(
      `SELECT key_hash FROM login_throttles WHERE scope = 'ADDRESS' AND locked_until > now()`,
    ),
  );
  assert.ok(rows.rows.every((r: any) => !String(r.key_hash).includes(clientA)));
});
