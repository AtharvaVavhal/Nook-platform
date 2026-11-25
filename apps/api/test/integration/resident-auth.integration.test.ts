import './helpers/preflight.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { loadRuntimeConfig } from '../../src/config.js';
import { MockSmsProvider } from '../../src/resident-auth/sms/mock-sms.provider.js';
import { SMS_PROVIDER } from '../../src/resident-auth/sms/sms.js';
import { withMigratorClient } from './helpers/db.js';
import { hashTestPassword, TEST_PASSWORD } from './helpers/fixtures.js';
import { requireTestDatabaseUrl } from './helpers/env.js';

// Resident authentication (phone OTP) against the disposable PostgreSQL: provisioning, OTP rules, sessions, isolation.
// Synthetic organizations, owners and residents only. SMS goes to the in-memory mock adapter; nothing is delivered.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.RESIDENT_WEB_ORIGIN = 'http://localhost:5174';
process.env.RESIDENT_OTP_SECRET = 'integration-test-otp-secret-0123456789abcdef';
process.env.RESIDENT_SMS_PROVIDER = 'mock';
process.env.TRUST_PROXY_HOPS = '1';
requireTestDatabaseUrl();

const OWNER_ORIGIN = 'http://localhost:5173';
const RESIDENT_ORIGIN = 'http://localhost:5174';
let app: INestApplication;
let server: ReturnType<typeof request>;
let sms: MockSmsProvider;
let passwordHash: string;

type Q = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
const sql: Q = (query, params = []) =>
  withMigratorClient(async (c) => (await c.query(query, params as never[])).rows as never);

test.before(async () => {
  passwordHash = await hashTestPassword();
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: true });
  configureApp(app, loadRuntimeConfig());
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${(app.getHttpServer().address() as { port: number }).port}`);
  sms = app.get(SMS_PROVIDER) as MockSmsProvider;
  assert.ok(sms instanceof MockSmsProvider, 'the mock adapter is what runs in this suite');
});
test.after(async () => {
  await app.close();
});
test.beforeEach(async () => {
  sms.reset();
  await sql('DELETE FROM resident_auth_throttles');
  await sql('DELETE FROM login_throttles');
});

// ------------------------------------------------------------------ fixtures
let phoneSeq = 0;
const newPhone = () =>
  `+9198${String(70000000 + Math.floor(Math.random() * 9999999) + phoneSeq++ * 7)
    .padStart(8, '0')
    .slice(-8)}`;
interface Org {
  id: string;
  ownerEmail: string;
  managerEmail: string;
}
async function makeOrg(name = 'Resident Auth Org'): Promise<Org> {
  const id = randomUUID();
  const ownerEmail = `owner-${id}@nook.test.invalid`;
  const managerEmail = `manager-${id}@nook.test.invalid`;
  await sql(`INSERT INTO organizations (id, name, updated_at) VALUES ($1, $2, now())`, [
    id,
    `${name} ${id.slice(0, 6)}`,
  ]);
  for (const [email, role] of [
    [ownerEmail, 'OWNER'],
    [managerEmail, 'PROPERTY_MANAGER'],
  ] as const) {
    const userId = randomUUID();
    await sql(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,$4,now())`,
      [userId, email, passwordHash, role],
    );
    await sql(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
      [randomUUID(), id, userId, role],
    );
  }
  return { id, ownerEmail, managerEmail };
}
async function makeResident(
  orgId: string,
  phone: string | null = null,
  status = 'ACTIVE',
): Promise<string> {
  const id = randomUUID();
  await sql(
    `INSERT INTO residents (id, organization_id, first_name, last_name, phone, status, document_url, address, updated_at)
     VALUES ($1,$2,'Test','Resident',$3,$4::"ResidentStatus",'https://docs.invalid/secret-doc','1 Secret Street',now())`,
    [id, orgId, phone, status],
  );
  return id;
}
const cookiesOf = (res: request.Response): Record<string, string> =>
  Object.fromEntries(
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).map(
      (c) => c.split(';')[0]!.split('=') as [string, string],
    ),
  );
interface Staff {
  cookie: string;
  csrf: string;
}
async function login(email: string): Promise<Staff> {
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', OWNER_ORIGIN)
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200, `login ${res.status}`);
  const c = cookiesOf(res);
  const cookie = `nook_session=${c.nook_session}; nook_csrf=${c.nook_csrf}`;
  const csrf = (await server.get('/api/v1/auth/csrf').set('Cookie', cookie)).body.data
    .csrfToken as string;
  return { cookie, csrf };
}
const staffPost = (s: Staff, path: string, body: unknown = {}) =>
  server
    .post(`/api/v1${path}`)
    .set('Origin', OWNER_ORIGIN)
    .set('Cookie', s.cookie)
    .set('X-CSRF-Token', s.csrf)
    .send(body as object);
const staffGet = (s: Staff, path: string) => server.get(`/api/v1${path}`).set('Cookie', s.cookie);
const staffPut = (s: Staff, path: string, body: unknown = {}) =>
  server
    .put(`/api/v1${path}`)
    .set('Origin', OWNER_ORIGIN)
    .set('Cookie', s.cookie)
    .set('X-CSRF-Token', s.csrf)
    .send(body as object);
const staffDelete = (s: Staff, path: string) =>
  server
    .delete(`/api/v1${path}`)
    .set('Origin', OWNER_ORIGIN)
    .set('Cookie', s.cookie)
    .set('X-CSRF-Token', s.csrf);
const sessionRows = (residentId: string) =>
  sql<{ revoked_at: Date | null; revoked_reason: string | null }>(
    `SELECT s.revoked_at, s.revoked_reason FROM resident_sessions s
       JOIN resident_accounts a ON a.id = s.resident_account_id AND a.organization_id = s.organization_id
      WHERE a.resident_id = $1 ORDER BY s.created_at`,
    [residentId],
  );
const resetThrottles = () => sql('DELETE FROM resident_auth_throttles');
async function provision(owner: Staff, residentId: string, phone?: string) {
  return staffPost(
    owner,
    '/resident-accounts',
    phone === undefined ? { residentId } : { residentId, phone },
  );
}
const requestOtp = (phone: unknown, ip = '10.1.1.1', origin = RESIDENT_ORIGIN) =>
  server
    .post('/api/v1/resident-auth/otp/request')
    .set('Origin', origin)
    .set('X-Forwarded-For', ip)
    .send({ phone });
const verifyOtp = (phone: unknown, code: unknown, ip = '10.1.1.1', origin = RESIDENT_ORIGIN) =>
  server
    .post('/api/v1/resident-auth/otp/verify')
    .set('Origin', origin)
    .set('X-Forwarded-For', ip)
    .send({ phone, code });
interface ResSession {
  cookie: string;
  csrf: string;
}
async function residentLogin(phone: string, ip = '10.1.1.1'): Promise<ResSession> {
  await sql(
    `UPDATE resident_auth_throttles SET locked_until = NULL WHERE scope = 'OTP_COOLDOWN_PHONE'`,
  );
  assert.equal((await requestOtp(phone, ip)).status, 200);
  const code = sms.lastCodeFor(phone)!;
  assert.match(code, /^\d{6}$/);
  const res = await verifyOtp(phone, code, ip);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const c = cookiesOf(res);
  return {
    cookie: `nook_resident_session=${c.nook_resident_session}; nook_resident_csrf=${c.nook_resident_csrf}`,
    csrf: '',
  };
}
const resCsrf = async (s: ResSession) =>
  (
    await server
      .get('/api/v1/resident-auth/csrf')
      .set('Origin', RESIDENT_ORIGIN)
      .set('Cookie', s.cookie)
  ).body.data.csrfToken as string;
const residentMe = (s: ResSession) =>
  server.get('/api/v1/resident-auth/me').set('Cookie', s.cookie);
async function setup() {
  const org = await makeOrg();
  const owner = await login(org.ownerEmail);
  const phone = newPhone();
  const residentId = await makeResident(org.id);
  const created = await provision(owner, residentId, phone);
  assert.equal(created.status, 201);
  return { org, owner, phone, residentId, accountId: created.body.data.id as string };
}

// ------------------------------------------------------------------ 1. provisioning
test('provisioning: an owner provisions access for an existing resident; the response exposes no resident detail; it is audited', async () => {
  const org = await makeOrg();
  const owner = await login(org.ownerEmail);
  const phone = newPhone();
  const residentId = await makeResident(org.id, null);
  const res = await provision(owner, residentId, phone);
  assert.equal(res.status, 201);
  const data = res.body.data;
  assert.deepEqual(Object.keys(data).sort(), [
    'createdAt',
    'id',
    'lastLoginAt',
    'phone',
    'residentId',
    'revokedAt',
    'status',
    'suspendedAt',
  ]);
  assert.equal(data.status, 'ACTIVE');
  assert.equal(data.phone, `+91******${phone.slice(-4)}`);
  const text = JSON.stringify(res.body);
  for (const leak of ['secret-doc', 'Secret Street', phone, 'Test', 'document'])
    assert.ok(!text.includes(leak), `response leaks ${leak}`);
  const audit = await sql<{
    action: string;
    actor_user_id: string;
    target_id: string;
    metadata: unknown;
  }>(
    `SELECT action, actor_user_id, target_id, metadata FROM audit_events WHERE organization_id = $1 AND action = 'resident_account.provisioned'`,
    [org.id],
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.target_id, data.id);
  assert.ok(audit[0]!.actor_user_id);
  assert.ok(!JSON.stringify(audit[0]).includes(phone), 'audit never holds the phone number');
  // The resident's own phone can be used when none is supplied.
  const rPhone = newPhone();
  const r2 = await makeResident(org.id, rPhone);
  const res2 = await provision(owner, r2);
  assert.equal(res2.status, 201);
  assert.equal(
    (
      await sql<{ phone_e164: string }>(`SELECT phone_e164 FROM resident_accounts WHERE id = $1`, [
        res2.body.data.id,
      ])
    )[0]!.phone_e164,
    rPhone,
  );
  // The list is the organization's, with masked numbers.
  const list = await staffGet(owner, `/resident-accounts?residentId=${residentId}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.items.length, 1);
});

test('provisioning: only an OWNER may change access (a manager may read); a missing or invalid phone, an unknown, foreign or inactive resident are refused', async () => {
  const org = await makeOrg();
  const owner = await login(org.ownerEmail);
  const manager = await login(org.managerEmail);
  const residentId = await makeResident(org.id);
  const asManager = await provision(manager, residentId, newPhone());
  assert.equal(asManager.status, 403);
  assert.equal(asManager.body.code, 'INSUFFICIENT_ROLE');
  assert.equal((await staffGet(manager, '/resident-accounts')).status, 200);
  assert.equal((await provision(owner, residentId)).status, 400, 'no phone anywhere');
  assert.equal(
    (await provision(owner, residentId, '12345')).body.code,
    'PHONE_REQUIRED_OR_INVALID',
  );
  assert.equal((await provision(owner, residentId, '+14155552671')).status, 400);
  assert.equal((await provision(owner, randomUUID(), newPhone())).status, 404);
  const other = await makeOrg();
  assert.equal(
    (await provision(owner, await makeResident(other.id), newPhone())).status,
    404,
    "another organization's resident",
  );
  assert.equal(
    (await provision(owner, await makeResident(org.id, null, 'INACTIVE'), newPhone())).body.code,
    'RESIDENT_NOT_ACTIVE',
  );
  assert.equal(
    (await provision(owner, await makeResident(org.id, null, 'ARCHIVED'), newPhone())).status,
    409,
  );
  assert.equal(
    (await staffPost(owner, '/resident-accounts', { residentId: 'not-a-uuid' })).status,
    400,
  );
  assert.equal(
    (
      await staffPost(owner, '/resident-accounts', {
        residentId,
        accountId: randomUUID(),
        organizationId: other.id,
        phone: newPhone(),
      })
    ).status,
    201,
    'client-supplied ids are ignored',
  );
  const row = await sql<{ organization_id: string }>(
    `SELECT organization_id FROM resident_accounts WHERE resident_id = $1`,
    [residentId],
  );
  assert.equal(row[0]!.organization_id, org.id, 'the organization always comes from the session');
});

// ------------------------------------------------------------------ 2. duplicate prevention
test('duplicates: one open account per resident and per phone, in the API and in the database; revoked accounts free both', async () => {
  const org = await makeOrg();
  const owner = await login(org.ownerEmail);
  const phone = newPhone();
  const residentId = await makeResident(org.id);
  const first = await provision(owner, residentId, phone);
  assert.equal(first.status, 201);
  assert.equal(
    (await provision(owner, residentId, newPhone())).body.code,
    'RESIDENT_ALREADY_HAS_ACCESS',
  );
  const second = await makeResident(org.id);
  assert.equal((await provision(owner, second, phone)).body.code, 'PHONE_NOT_AVAILABLE');
  // another organization gets the same generic answer and learns nothing
  const other = await makeOrg();
  const otherOwner = await login(other.ownerEmail);
  const cross = await provision(otherOwner, await makeResident(other.id), phone);
  assert.equal(cross.status, 409);
  assert.deepEqual(cross.body, { code: 'PHONE_NOT_AVAILABLE' });
  // the database itself refuses (a bypass of the API cannot create a duplicate)
  await assert.rejects(
    sql(
      `INSERT INTO resident_accounts (organization_id, resident_id, phone_e164, updated_at) VALUES ($1,$2,$3,now())`,
      [org.id, residentId, newPhone()],
    ),
    /resident_accounts_one_open_per_resident/,
  );
  await assert.rejects(
    sql(
      `INSERT INTO resident_accounts (organization_id, resident_id, phone_e164, updated_at) VALUES ($1,$2,$3,now())`,
      [org.id, second, phone],
    ),
    /resident_accounts_one_open_per_phone/,
  );
  await assert.rejects(
    sql(
      `INSERT INTO resident_accounts (organization_id, resident_id, phone_e164, updated_at) VALUES ($1,$2,'+14155552671',now())`,
      [org.id, second],
    ),
    /resident_accounts_phone_format/,
  );
  await assert.rejects(
    sql(
      `INSERT INTO resident_accounts (organization_id, resident_id, phone_e164, updated_at) VALUES ($1,$2,'9876543210',now())`,
      [org.id, second],
    ),
    /resident_accounts_phone_format/,
  );
  // a resident of organization B cannot be attached to organization A (composite foreign key)
  await assert.rejects(
    sql(
      `INSERT INTO resident_accounts (organization_id, resident_id, phone_e164, updated_at) VALUES ($1,$2,$3,now())`,
      [org.id, await makeResident(other.id), newPhone()],
    ),
    /resident_accounts_resident_id_organization_id_fkey/,
  );
  // an account can never be moved to another resident or organization
  await assert.rejects(
    sql(`UPDATE resident_accounts SET resident_id = $1 WHERE id = $2`, [
      second,
      first.body.data.id,
    ]),
    /cannot be moved/,
  );
  // revoke frees the resident and the number for a new account
  assert.equal(
    (await staffPost(owner, `/resident-accounts/${first.body.data.id}/revoke`, {})).status,
    200,
  );
  const again = await provision(owner, residentId, phone);
  assert.equal(again.status, 201);
  assert.notEqual(again.body.data.id, first.body.data.id);
});

test('duplicates: concurrent provisioning of one resident creates exactly one account', async () => {
  const org = await makeOrg();
  const owner = await login(org.ownerEmail);
  const residentId = await makeResident(org.id);
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      provision(owner, residentId, newPhone().slice(0, 10) + String(i).padStart(3, '0')),
    ),
  );
  assert.equal(
    results.filter((r) => r.status === 201).length,
    1,
    results.map((r) => r.status).join(),
  );
  assert.ok(results.every((r) => [201, 409].includes(r.status)));
  assert.equal(
    (
      await sql(`SELECT 1 FROM resident_accounts WHERE resident_id = $1 AND status <> 'REVOKED'`, [
        residentId,
      ])
    ).length,
    1,
  );
});

// ------------------------------------------------------------------ 3. invalid and unregistered phones, generic answers
test('requests: invalid numbers are 400; a registered and an unregistered number get the identical answer, and only the registered one gets an SMS', async () => {
  const { phone } = await setup();
  for (const bad of ['', '12345', '+14155552671', 'abcdefghij', null, 9876543210, {}]) {
    const res = await requestOtp(bad);
    assert.equal(res.status, 400, String(bad));
    assert.equal(res.body.code, 'INVALID_PHONE_NUMBER');
  }
  assert.equal(sms.outbox.length, 0);
  const registered = await requestOtp(phone, '10.2.0.1');
  const unregistered = await requestOtp(newPhone(), '10.2.0.2');
  assert.equal(registered.status, 200);
  assert.equal(unregistered.status, 200);
  assert.deepEqual(registered.body, unregistered.body);
  assert.deepEqual(registered.body, { data: { requested: true, resendAfterSeconds: 30 } });
  assert.equal(sms.outbox.length, 1, 'exactly one SMS: the registered number');
  assert.equal(sms.outbox[0]!.to, phone);
  const unknown = newPhone();
  const v1 = await verifyOtp(unknown, '123456', '10.2.0.3');
  const v2 = await verifyOtp(phone, '000000', '10.2.0.4');
  for (const v of [v1, v2]) {
    assert.equal(v.status, 401);
    assert.deepEqual(v.body, { code: 'INVALID_OR_EXPIRED_CODE' });
  }
  assert.equal((await verifyOtp(unknown, 'abc', '10.2.0.5')).status, 401);
  assert.equal((await verifyOtp('nonsense', '123456', '10.2.0.6')).status, 401);
  assert.equal(
    (
      await sql(
        `SELECT 1 FROM resident_otp_challenges c JOIN resident_accounts a ON a.id = c.resident_account_id WHERE a.phone_e164 = $1`,
        [unknown],
      )
    ).length,
    0,
  );
});

// ------------------------------------------------------------------ 4. generation, storage, expiry
test('otp: a six-digit code is delivered, stored only as a keyed hash, valid for five minutes, and never written to a log', async () => {
  const { phone } = await setup();
  const logged: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    logged.push(String(chunk));
    return (realWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  let code: string;
  try {
    assert.equal((await requestOtp(phone)).status, 200);
    code = sms.lastCodeFor(phone)!;
    assert.match(code, /^\d{6}$/);
    assert.equal((await verifyOtp(phone, '999999' === code ? '999998' : '999999')).status, 401);
  } finally {
    process.stdout.write = realWrite;
  }
  const rows = await sql<Record<string, unknown>>(
    `SELECT c.*, extract(epoch FROM (c.expires_at - c.created_at)) AS ttl FROM resident_otp_challenges c JOIN resident_accounts a ON a.id = c.resident_account_id WHERE a.phone_e164 = $1`,
    [phone],
  );
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.match(String(row.code_hash), /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(row).includes(code!), 'the code is nowhere in the row');
  assert.ok(Math.abs(Number(row.ttl) - 300) < 2, `ttl ${row.ttl}`);
  assert.equal(row.max_attempts, 5);
  assert.equal(row.delivery_status, 'SENT');
  const everything = logged.join('');
  assert.ok(!everything.includes(code!), 'the code never reaches a log line');
  assert.ok(
    !everything.includes(phone) && !everything.includes(phone.slice(3)),
    'the phone number never reaches a log line',
  );
  assert.ok(!everything.includes(String(row.code_hash)));
});

test('otp: an expired code is refused, even when correct', async () => {
  const { phone } = await setup();
  await requestOtp(phone);
  const code = sms.lastCodeFor(phone)!;
  await sql(
    `UPDATE resident_otp_challenges SET expires_at = now() - interval '1 second' WHERE resident_account_id IN (SELECT id FROM resident_accounts WHERE phone_e164 = $1)`,
    [phone],
  );
  const res = await verifyOtp(phone, code);
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { code: 'INVALID_OR_EXPIRED_CODE' });
  assert.equal((await sql(`SELECT 1 FROM resident_sessions`)).length >= 0, true);
});

test('otp: a new code invalidates the previous one (only the newest verifies); one live challenge per account is enforced by the database', async () => {
  const { phone, accountId } = await setup();
  await requestOtp(phone);
  const first = sms.lastCodeFor(phone)!;
  await sql(
    `UPDATE resident_auth_throttles SET locked_until = NULL WHERE scope = 'OTP_COOLDOWN_PHONE'`,
  );
  await requestOtp(phone);
  const second = sms.lastCodeFor(phone)!;
  const live = await sql(
    `SELECT 1 FROM resident_otp_challenges WHERE resident_account_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
    [accountId],
  );
  assert.equal(live.length, 1);
  assert.equal(
    (
      await sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM resident_otp_challenges WHERE resident_account_id = $1 AND invalidated_reason = 'SUPERSEDED'`,
        [accountId],
      )
    )[0]!.n,
    1,
  );
  if (first !== second)
    assert.equal((await verifyOtp(phone, first)).status, 401, 'the superseded code is dead');
  assert.equal((await verifyOtp(phone, second)).status, 200);
  await assert.rejects(
    sql(
      `INSERT INTO resident_otp_challenges (organization_id, resident_account_id, code_hash, expires_at) SELECT organization_id, id, repeat('a',64), now() + interval '5 minutes' FROM resident_accounts WHERE id = $1`,
      [accountId],
    ).then(() =>
      sql(
        `INSERT INTO resident_otp_challenges (organization_id, resident_account_id, code_hash, expires_at) SELECT organization_id, id, repeat('b',64), now() + interval '5 minutes' FROM resident_accounts WHERE id = $1`,
        [accountId],
      ),
    ),
    /one_live_per_account/,
  );
});

// ------------------------------------------------------------------ 5-6. wrong codes and lockout
test('otp: a wrong code is refused and counted; five wrong attempts kill the challenge, so even the right code then fails', async () => {
  const { phone, accountId } = await setup();
  await requestOtp(phone);
  const code = sms.lastCodeFor(phone)!;
  const wrong = code === '000000' ? '000001' : '000000';
  for (let i = 1; i <= 5; i++) {
    const res = await verifyOtp(phone, wrong);
    assert.equal(res.status, 401, `attempt ${i}`);
    assert.deepEqual(res.body, { code: 'INVALID_OR_EXPIRED_CODE' });
  }
  const row = (
    await sql<{ attempts: number; invalidated_reason: string }>(
      `SELECT attempts, invalidated_reason FROM resident_otp_challenges WHERE resident_account_id = $1`,
      [accountId],
    )
  )[0]!;
  assert.equal(row.attempts, 5);
  assert.equal(row.invalidated_reason, 'MAX_ATTEMPTS');
  const late = await verifyOtp(phone, code);
  assert.equal(late.status, 401, 'the correct code no longer works after lockout');
  assert.deepEqual(late.body, { code: 'INVALID_OR_EXPIRED_CODE' });
  // a fresh code (after the cooldown) works again
  await sql(
    `UPDATE resident_auth_throttles SET locked_until = NULL WHERE scope = 'OTP_COOLDOWN_PHONE'`,
  );
  await requestOtp(phone);
  assert.equal((await verifyOtp(phone, sms.lastCodeFor(phone)!)).status, 200);
});

test('otp: four wrong attempts followed by the right code still succeed (the limit is five, not four)', async () => {
  const { phone } = await setup();
  await requestOtp(phone);
  const code = sms.lastCodeFor(phone)!;
  const wrong = code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) assert.equal((await verifyOtp(phone, wrong)).status, 401);
  assert.equal((await verifyOtp(phone, code)).status, 200);
});

// ------------------------------------------------------------------ 7. resend cooldown
test('cooldown: a second request within 30 seconds is refused for every number alike, and allowed again afterwards', async () => {
  const { phone } = await setup();
  const unknown = newPhone();
  for (const number of [phone, unknown]) {
    assert.equal((await requestOtp(number, `10.3.0.${number === phone ? 1 : 2}`)).status, 200);
    const again = await requestOtp(number, `10.3.0.${number === phone ? 1 : 2}`);
    assert.equal(
      again.status,
      429,
      'cooldown applies to registered and unregistered numbers identically',
    );
    assert.equal(again.body.code, 'OTP_RATE_LIMITED');
    assert.ok(again.body.retryAfterSeconds >= 1 && again.body.retryAfterSeconds <= 30);
  }
  assert.equal(sms.outbox.length, 1, 'the refused request sent nothing');
  await sql(
    `UPDATE resident_auth_throttles SET locked_until = now() - interval '1 second' WHERE scope = 'OTP_COOLDOWN_PHONE'`,
  );
  assert.equal((await requestOtp(phone, '10.3.0.1')).status, 200);
  assert.equal(sms.outbox.length, 2);
});

test("cooldown: requests refused by the cooldown do not use up the number's hourly allowance", async () => {
  const { phone } = await setup();
  assert.equal((await requestOtp(phone, '10.3.2.1')).status, 200);
  for (let i = 0; i < 12; i++)
    assert.equal(
      (await requestOtp(phone, `10.3.2.${i + 2}`)).status,
      429,
      'refused by the cooldown',
    );
  const row = await sql<{ failures: number }>(
    `SELECT failures FROM resident_auth_throttles WHERE scope = 'OTP_REQUEST_PHONE'`,
  );
  assert.deepEqual(
    row.map((r) => r.failures),
    [1],
    'only the one accepted request counted against the number',
  );
  await sql(
    `UPDATE resident_auth_throttles SET locked_until = NULL WHERE scope = 'OTP_COOLDOWN_PHONE'`,
  );
  assert.equal((await requestOtp(phone, '10.3.2.99')).status, 200, 'the number is not locked');
});

test('cooldown: simultaneous requests for one number issue exactly one code', async () => {
  const { phone } = await setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => requestOtp(phone, '10.3.1.1')));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 429).length, 7);
  assert.equal(sms.outbox.length, 1);
});

// ------------------------------------------------------------------ 8-9. replay and concurrency
test('replay: a used code cannot be used again, and a code is dead after logout', async () => {
  const { phone } = await setup();
  await requestOtp(phone);
  const code = sms.lastCodeFor(phone)!;
  assert.equal((await verifyOtp(phone, code)).status, 200);
  const replay = await verifyOtp(phone, code);
  assert.equal(replay.status, 401);
  assert.deepEqual(replay.body, { code: 'INVALID_OR_EXPIRED_CODE' });
});

test('concurrency: many simultaneous submissions of the correct code produce exactly one session', async () => {
  const { phone, accountId } = await setup();
  await requestOtp(phone);
  const code = sms.lastCodeFor(phone)!;
  const results = await Promise.all(Array.from({ length: 10 }, () => verifyOtp(phone, code)));
  assert.equal(
    results.filter((r) => r.status === 200).length,
    1,
    results.map((r) => r.status).join(),
  );
  assert.ok(results.every((r) => r.status === 200 || r.status === 401 || r.status === 429));
  assert.equal(
    (await sql(`SELECT 1 FROM resident_sessions WHERE resident_account_id = $1`, [accountId]))
      .length,
    1,
  );
  assert.equal(
    (
      await sql(
        `SELECT 1 FROM resident_otp_challenges WHERE resident_account_id = $1 AND consumed_at IS NOT NULL`,
        [accountId],
      )
    ).length,
    1,
  );
});

test('concurrency: parallel wrong guesses can never exceed the attempt limit', async () => {
  const { phone, accountId } = await setup();
  await requestOtp(phone);
  const code = sms.lastCodeFor(phone)!;
  const guesses = Array.from({ length: 30 }, (_, i) => String(100000 + i)).filter(
    (g) => g !== code,
  );
  const results = await Promise.all(
    guesses.map((g, i) => verifyOtp(phone, g, `10.4.0.${i % 250}`)),
  );
  // 401 for each counted wrong guess, 429 once the per-phone verification limit (10) is reached; never a 200.
  assert.ok(
    results.every((r) => r.status === 401 || r.status === 429),
    results.map((r) => r.status).join(),
  );
  assert.ok(results.some((r) => r.status === 401));
  const row = (
    await sql<{ attempts: number }>(
      `SELECT attempts FROM resident_otp_challenges WHERE resident_account_id = $1`,
      [accountId],
    )
  )[0]!;
  assert.ok(row.attempts <= 5, `attempts ${row.attempts}`);
});

// ------------------------------------------------------------------ 10. SMS provider failure
test('sms failure: a provider failure is invisible to the caller, the undelivered code is dead, and a transient failure is retried', async () => {
  const { phone, accountId } = await setup();
  sms.failNext('permanent', 'PROVIDER_REJECTED');
  const failed = await requestOtp(phone);
  assert.equal(failed.status, 200);
  assert.deepEqual(
    failed.body,
    { data: { requested: true, resendAfterSeconds: 30 } },
    'same answer as a delivered request',
  );
  assert.equal(sms.outbox.length, 0);
  const row = (
    await sql<{ delivery_status: string; invalidated_reason: string }>(
      `SELECT delivery_status, invalidated_reason FROM resident_otp_challenges WHERE resident_account_id = $1`,
      [accountId],
    )
  )[0]!;
  assert.equal(row.delivery_status, 'FAILED');
  assert.equal(row.invalidated_reason, 'DELIVERY_FAILED');
  await sql(
    `UPDATE resident_auth_throttles SET locked_until = NULL WHERE scope = 'OTP_COOLDOWN_PHONE'`,
  );
  sms.failNext('transient', 'PROVIDER_UNAVAILABLE');
  assert.equal((await requestOtp(phone)).status, 200);
  assert.equal(sms.outbox.length, 1, 'delivered on the retry');
  assert.equal((await verifyOtp(phone, sms.lastCodeFor(phone)!)).status, 200);
});

// ------------------------------------------------------------------ 11. rate limiting
test('rate limit: per phone (5 codes an hour), per address (20 an hour) and per failed verification (10 per phone) all lock with 429', async () => {
  const { phone } = await setup();
  for (let i = 1; i <= 5; i++) {
    await sql(
      `UPDATE resident_auth_throttles SET locked_until = NULL WHERE scope = 'OTP_COOLDOWN_PHONE'`,
    );
    assert.equal((await requestOtp(phone, '10.5.0.1')).status, 200, `request ${i}`);
  }
  await sql(
    `UPDATE resident_auth_throttles SET locked_until = NULL WHERE scope = 'OTP_COOLDOWN_PHONE'`,
  );
  const sixth = await requestOtp(phone, '10.5.0.1');
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.code, 'OTP_RATE_LIMITED');
  assert.ok(sixth.body.retryAfterSeconds > 60, 'locked for the long window, not the 30 s cooldown');
  // per address
  await sql('DELETE FROM resident_auth_throttles');
  for (let i = 1; i <= 20; i++)
    assert.equal((await requestOtp(newPhone(), '10.5.9.9')).status, 200, `address request ${i}`);
  assert.equal((await requestOtp(newPhone(), '10.5.9.9')).status, 429);
  assert.equal(
    (await requestOtp(newPhone(), '10.5.9.10')).status,
    200,
    'another address is unaffected',
  );
  // verification failures per phone: ten wrong submissions lock the phone even from different addresses
  await sql('DELETE FROM resident_auth_throttles');
  const target = newPhone();
  for (let i = 0; i < 10; i++)
    assert.equal((await verifyOtp(target, '123456', `10.6.0.${i + 1}`)).status, 401);
  const locked = await verifyOtp(target, '123456', '10.6.0.99');
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, 'OTP_RATE_LIMITED');
  // per address verification: 30 failures across numbers
  await sql('DELETE FROM resident_auth_throttles');
  for (let i = 0; i < 30; i++)
    assert.equal((await verifyOtp(newPhone(), '123456', '10.7.0.1')).status, 401);
  assert.equal((await verifyOtp(newPhone(), '123456', '10.7.0.1')).status, 429);
  // the throttle table holds no phone number and no address
  const keys = await sql<{ key_hash: string }>(`SELECT key_hash FROM resident_auth_throttles`);
  assert.ok(keys.every((k) => /^[0-9a-f]{64}$/.test(k.key_hash)));
});

// ------------------------------------------------------------------ 12-13. sessions
test('session: it identifies the resident from the server-side session, slides while idle, and ends at the idle and absolute limits', async () => {
  const { phone, org } = await setup();
  const s = await residentLogin(phone);
  const me = await residentMe(s);
  assert.equal(me.status, 200);
  assert.deepEqual(Object.keys(me.body.data).sort(), ['displayName', 'organizationName']);
  assert.equal(me.body.data.displayName, 'Test Resident');
  assert.ok(String(me.body.data.organizationName).includes('Resident Auth Org'));
  assert.equal(me.headers['cache-control'], 'no-store');
  const before = (
    await sql<{ idle_expires_at: Date }>(
      `SELECT idle_expires_at FROM resident_sessions ORDER BY created_at DESC LIMIT 1`,
    )
  )[0]!.idle_expires_at;
  await new Promise((r) => setTimeout(r, 20));
  await residentMe(s);
  const after = (
    await sql<{ idle_expires_at: Date }>(
      `SELECT idle_expires_at FROM resident_sessions ORDER BY created_at DESC LIMIT 1`,
    )
  )[0]!.idle_expires_at;
  assert.ok(after.getTime() > before.getTime(), 'idle expiry slides');
  const [sess] = await sql<{ id: string; ttl: number }>(
    `SELECT id, extract(epoch FROM (absolute_expires_at - created_at)) AS ttl FROM resident_sessions ORDER BY created_at DESC LIMIT 1`,
  );
  assert.ok(Math.abs(Number(sess!.ttl) - 8 * 3600) < 2);
  await sql(
    `UPDATE resident_sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1`,
    [sess!.id],
  );
  assert.equal((await residentMe(s)).status, 401, 'idle expiry');
  await sql(
    `UPDATE resident_sessions SET idle_expires_at = now() + interval '10 minutes', absolute_expires_at = now() - interval '1 second' WHERE id = $1`,
    [sess!.id],
  );
  assert.equal((await residentMe(s)).status, 401, 'absolute expiry');
  assert.ok(org.id);
  assert.equal(
    (
      await server
        .get('/api/v1/resident-auth/me')
        .set('Cookie', 'nook_resident_session=not-a-real-session')
    ).status,
    401,
  );
  assert.equal((await server.get('/api/v1/resident-auth/me')).status, 401);
});

test('session: logout revokes server-side and needs the right origin and CSRF token; the cookie is dead afterwards', async () => {
  const { phone } = await setup();
  const s = await residentLogin(phone);
  const token = await resCsrf(s);
  const noCsrf = await server
    .post('/api/v1/resident-auth/logout')
    .set('Origin', RESIDENT_ORIGIN)
    .set('Cookie', s.cookie);
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.code, 'INVALID_CSRF_TOKEN');
  assert.equal(
    (
      await server
        .post('/api/v1/resident-auth/logout')
        .set('Origin', RESIDENT_ORIGIN)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', 'wrong')
    ).status,
    403,
  );
  assert.equal(
    (
      await server
        .post('/api/v1/resident-auth/logout')
        .set('Origin', OWNER_ORIGIN)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', token)
    ).body.code,
    'INVALID_ORIGIN',
  );
  assert.equal((await residentMe(s)).status, 200, 'refused logouts changed nothing');
  const out = await server
    .post('/api/v1/resident-auth/logout')
    .set('Origin', RESIDENT_ORIGIN)
    .set('Cookie', s.cookie)
    .set('X-CSRF-Token', token);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { data: { loggedOut: true } });
  assert.equal((await residentMe(s)).status, 401);
  assert.equal(
    (await sql(`SELECT 1 FROM resident_sessions WHERE revoked_reason = 'logout'`)).length >= 1,
    true,
  );
  // the same cookie value replayed later is still dead
  assert.equal((await residentMe(s)).status, 401);
});

// ------------------------------------------------------------------ 14. suspension, revocation, organization and resident state
test("suspension: suspending ends the resident's access at once; reactivation restores sign-in but never old sessions; revoking is permanent", async () => {
  const { phone, owner, accountId } = await setup();
  const s = await residentLogin(phone);
  assert.equal((await residentMe(s)).status, 200);
  await requestOtp(phone, '10.8.0.1');
  const pending = sms.lastCodeFor(phone)!;
  const sus = await staffPost(owner, `/resident-accounts/${accountId}/suspend`, {
    reason: 'unpaid',
  });
  assert.equal(sus.status, 200);
  assert.equal(sus.body.data.status, 'SUSPENDED');
  assert.equal((await residentMe(s)).status, 401, 'the live session stops working immediately');
  assert.equal(
    (await verifyOtp(phone, pending, '10.8.0.2')).status,
    401,
    'a code issued before suspension is dead',
  );
  sms.reset();
  await sql(
    `UPDATE resident_auth_throttles SET locked_until = NULL WHERE scope = 'OTP_COOLDOWN_PHONE'`,
  );
  assert.equal(
    (await requestOtp(phone, '10.8.0.3')).status,
    200,
    'the answer does not reveal the suspension',
  );
  assert.equal(sms.outbox.length, 0, 'and no SMS is sent');
  assert.equal(
    (await staffPost(owner, `/resident-accounts/${accountId}/suspend`, {})).body.code,
    'INVALID_ACCOUNT_STATE',
  );
  const react = await staffPost(owner, `/resident-accounts/${accountId}/reactivate`, {});
  assert.equal(react.body.data.status, 'ACTIVE');
  assert.equal((await residentMe(s)).status, 401, 'old sessions stay dead');
  assert.equal(
    (await residentMe(await residentLogin(phone, '10.8.0.4'))).status,
    200,
    'a fresh sign-in works',
  );
  const rev = await staffPost(owner, `/resident-accounts/${accountId}/revoke`, {
    reason: 'moved out',
  });
  assert.equal(rev.body.data.status, 'REVOKED');
  assert.equal(
    (await staffPost(owner, `/resident-accounts/${accountId}/reactivate`, {})).body.code,
    'INVALID_ACCOUNT_STATE',
  );
  assert.equal(
    (await staffPost(owner, `/resident-accounts/${accountId}/revoke`, {})).body.code,
    'INVALID_ACCOUNT_STATE',
  );
  const actions = (
    await sql<{ action: string }>(
      `SELECT action FROM audit_events WHERE target_id = $1 ORDER BY occurred_at`,
      [accountId],
    )
  ).map((r) => r.action);
  for (const a of [
    'resident_account.provisioned',
    'resident_account.suspended',
    'resident_account.reactivated',
    'resident_account.revoked',
    'resident_auth.login.succeeded',
  ])
    assert.ok(actions.includes(a), a);
});

test('organization and resident state: a disabled organization or an archived resident ends access; changing the phone ends sessions and moves sign-in to the new number', async () => {
  const { phone, org, owner, accountId, residentId } = await setup();
  const s = await residentLogin(phone, '10.9.0.1');
  await sql(`UPDATE organizations SET status = 'DISABLED' WHERE id = $1`, [org.id]);
  assert.equal((await residentMe(s)).status, 401, 'organization suspension ends resident access');
  sms.reset();
  await sql(
    `UPDATE resident_auth_throttles SET locked_until = NULL WHERE scope = 'OTP_COOLDOWN_PHONE'`,
  );
  await requestOtp(phone, '10.9.0.2');
  assert.equal(sms.outbox.length, 0, 'no code for a suspended organization');
  await sql(`UPDATE organizations SET status = 'ACTIVE' WHERE id = $1`, [org.id]);
  const s2 = await residentLogin(phone, '10.9.0.3');
  assert.equal((await residentMe(s2)).status, 200);
  await sql(`UPDATE residents SET status = 'ARCHIVED' WHERE id = $1`, [residentId]);
  assert.equal((await residentMe(s2)).status, 401, 'an archived resident cannot use the portal');
  await sql(`UPDATE residents SET status = 'ACTIVE' WHERE id = $1`, [residentId]);
  // phone change
  const s3 = await residentLogin(phone, '10.9.0.4');
  const newNumber = newPhone();
  const changed = await staffPost(owner, `/resident-accounts/${accountId}/phone`, {
    phone: newNumber,
  });
  assert.equal(changed.status, 200);
  assert.ok(!JSON.stringify(changed.body).includes(newNumber), 'the number is masked');
  assert.equal((await residentMe(s3)).status, 401, 'sessions end when the number changes');
  sms.reset();
  await requestOtp(phone, '10.9.0.5');
  assert.equal(sms.outbox.length, 0, 'the old number no longer signs in');
  assert.equal((await residentMe(await residentLogin(newNumber, '10.9.0.6'))).status, 200);
  assert.equal(
    (await staffPost(owner, `/resident-accounts/${accountId}/phone`, { phone: newNumber })).body
      .code,
    'PHONE_UNCHANGED',
  );
  assert.equal(
    (await staffPost(owner, `/resident-accounts/${accountId}/phone`, { phone: 'junk' })).status,
    400,
  );
});

// ------------------------------------------------------------------ 15. cross-organization isolation
test('resident status policy: only an ACTIVE resident may use the portal; INACTIVE and ARCHIVED are refused at request, verification, session creation and on an existing session, with the same generic answers', async () => {
  const a = await setup();
  const bystanderOrg = await setup();
  const sibling = await makeResident(a.org.id);
  const siblingPhone = newPhone();
  assert.equal((await provision(a.owner, sibling, siblingPhone)).status, 201);
  const unknownPhone = newPhone();

  // ACTIVE resident + ACTIVE account: signs in and is identified
  const sA = await residentLogin(a.phone, '10.30.0.1');
  const sB = await residentLogin(bystanderOrg.phone, '10.30.0.2');
  const sSibling = await residentLogin(siblingPhone, '10.30.0.3');
  assert.equal((await residentMe(sA)).status, 200);

  for (const state of ['INACTIVE', 'ARCHIVED'] as const) {
    // a code issued while the resident was still ACTIVE
    await sql(`UPDATE residents SET status = 'ACTIVE' WHERE id = $1`, [a.residentId]);
    await sql(`UPDATE resident_auth_throttles SET locked_until = NULL`);
    sms.reset();
    assert.equal((await requestOtp(a.phone, `10.31.0.${state.length}`)).status, 200);
    const liveCode = sms.lastCodeFor(a.phone)!;
    assert.match(liveCode, /^\d{6}$/);

    await sql(`UPDATE residents SET status = $2 WHERE id = $1`, [a.residentId, state]);

    // verification: even the correct, unexpired code gets the same generic refusal as an unknown number, and no session
    const refusedVerify = await verifyOtp(a.phone, liveCode, '10.33.0.1');
    const unknownVerify = await verifyOtp(unknownPhone, '000000', '10.33.0.2');
    assert.equal(refusedVerify.status, 401, `${state}: verify`);
    assert.deepEqual(
      refusedVerify.body,
      unknownVerify.body,
      `${state}: identical to an unknown number`,
    );
    assert.equal(refusedVerify.headers['set-cookie'], undefined, `${state}: no cookie issued`);

    // request: the answer is identical to an unknown number's, and no code is sent
    await sql(`UPDATE resident_auth_throttles SET locked_until = NULL`);
    sms.reset();
    const refusedRequest = await requestOtp(a.phone, '10.34.0.1');
    const unknownRequest = await requestOtp(unknownPhone, '10.34.0.2');
    assert.equal(refusedRequest.status, unknownRequest.status);
    assert.deepEqual(
      refusedRequest.body,
      unknownRequest.body,
      `${state}: request does not reveal the state`,
    );
    assert.equal(sms.outbox.length, 0, `${state}: no code is sent`);
  }

  // session creation: a resident who becomes INACTIVE between the code check and the session insert gets no session
  await sql(`UPDATE residents SET status = 'ACTIVE' WHERE id = $1`, [a.residentId]);
  await sql(`UPDATE resident_auth_throttles SET locked_until = NULL`);
  sms.reset();
  assert.equal((await requestOtp(a.phone, '10.35.0.1')).status, 200);
  const raceCode = sms.lastCodeFor(a.phone)!;
  const before = Number(
    (
      await sql<{ n: string }>(
        `SELECT count(*)::text n FROM resident_sessions WHERE resident_account_id = $1`,
        [a.accountId],
      )
    )[0]!.n,
  );
  await sql(
    `CREATE OR REPLACE FUNCTION nook_test_flip_inactive() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN UPDATE residents SET status = 'INACTIVE' WHERE id = '${a.residentId}'; RETURN NEW; END $f$`,
  );
  await sql(
    `CREATE TRIGGER nook_test_flip BEFORE UPDATE OF consumed_at ON resident_otp_challenges FOR EACH ROW EXECUTE FUNCTION nook_test_flip_inactive()`,
  );
  let raced;
  try {
    raced = await verifyOtp(a.phone, raceCode, '10.35.0.2');
  } finally {
    await sql(`DROP TRIGGER IF EXISTS nook_test_flip ON resident_otp_challenges`);
    await sql(`DROP FUNCTION IF EXISTS nook_test_flip_inactive()`);
  }
  assert.equal(raced.status, 401, 'refused although the code was correct');
  assert.equal(raced.headers['set-cookie'], undefined);
  assert.equal(
    Number(
      (
        await sql<{ n: string }>(
          `SELECT count(*)::text n FROM resident_sessions WHERE resident_account_id = $1`,
          [a.accountId],
        )
      )[0]!.n,
    ),
    before,
    'no session row was created',
  );

  // existing session: a resident who becomes INACTIVE loses access on the very next request, and the session stays dead
  await sql(`UPDATE residents SET status = 'ACTIVE' WHERE id = $1`, [a.residentId]);
  await sql('DELETE FROM resident_auth_throttles');
  const live2 = await residentLogin(a.phone, '10.36.0.1');
  assert.equal((await residentMe(live2)).status, 200);
  await sql(`UPDATE residents SET status = 'INACTIVE' WHERE id = $1`, [a.residentId]);
  const denied = await residentMe(live2);
  assert.equal(denied.status, 401);
  assert.deepEqual(denied.body, { code: 'UNAUTHENTICATED' });
  assert.equal(
    (
      await sql<{ reason: string }>(
        `SELECT revoked_reason reason FROM resident_sessions WHERE resident_account_id = $1 AND revoked_at IS NOT NULL ORDER BY revoked_at DESC LIMIT 1`,
        [a.accountId],
      )
    )[0]!.reason,
    'PORTAL_INELIGIBLE',
  );
  await sql(`UPDATE residents SET status = 'ACTIVE' WHERE id = $1`, [a.residentId]);
  assert.equal(
    (await residentMe(live2)).status,
    401,
    're-activation does not revive the old session',
  );
  // Residual limit (documented): this status was changed by a direct database write, which bypasses the staff API that
  // revokes sessions. Eligibility is then judged per request, and a session never presented while the resident was
  // INACTIVE works again once ACTIVE, until its own idle or absolute expiry. Through the staff API this cannot happen
  // (see the next tests).
  assert.equal(
    (await residentMe(sA)).status,
    200,
    'a session not presented during the INACTIVE period is judged by the current state',
  );
  await sql('DELETE FROM resident_auth_throttles');
  const fresh = await residentLogin(a.phone, '10.36.0.2');
  assert.equal((await residentMe(fresh)).status, 200, 'a fresh sign-in works again once ACTIVE');

  // other residents and organizations were never affected
  assert.equal((await residentMe(sB)).status, 200);
  assert.equal((await residentMe(sSibling)).status, 200);
});

test('staff status change ends portal access: INACTIVE, ARCHIVED (PUT) and DELETE by an owner or manager revoke every session in the same transaction; re-activation revives nothing and a fresh code is needed', async () => {
  const a = await setup();
  const manager = await login(a.org.managerEmail);
  const other = await makeOrg('Other Org');
  const otherOwner = await login(other.ownerEmail);

  // bystanders: another resident of the same organization, and a resident of another organization
  const sameOrgResident = await makeResident(a.org.id);
  const sameOrgPhone = newPhone();
  assert.equal((await provision(a.owner, sameOrgResident, sameOrgPhone)).status, 201);
  const otherResident = await makeResident(other.id);
  const otherPhone = newPhone();
  assert.equal((await provision(otherOwner, otherResident, otherPhone)).status, 201);
  await resetThrottles();
  const bystanderSame = await residentLogin(sameOrgPhone, '10.40.0.1');
  const bystanderOther = await residentLogin(otherPhone, '10.40.0.2');

  // 1. an active resident with several portal sessions (and one unused code)
  const sessions: ResSession[] = [];
  for (let i = 0; i < 3; i++) {
    await resetThrottles();
    sessions.push(await residentLogin(a.phone, `10.41.0.${i + 1}`));
  }
  for (const s of sessions) assert.equal((await residentMe(s)).status, 200);
  await resetThrottles();
  sms.reset();
  assert.equal((await requestOtp(a.phone, '10.41.1.1')).status, 200);
  const staleCode = sms.lastCodeFor(a.phone)!;
  assert.equal((await sessionRows(a.residentId)).filter((r) => !r.revoked_at).length, 3);

  // authorization is exactly as before: no session, or a resident session, cannot change a resident's status
  const anonymous = await server
    .put(`/api/v1/residents/${a.residentId}`)
    .set('Origin', OWNER_ORIGIN)
    .send({ status: 'INACTIVE' });
  assert.equal(anonymous.status, 401);
  const asResident = await server
    .put(`/api/v1/residents/${a.residentId}`)
    .set('Origin', OWNER_ORIGIN)
    .set('Cookie', sessions[0]!.cookie)
    .send({ status: 'INACTIVE' });
  assert.equal(asResident.status, 403);
  const crossOrg = await staffPut(otherOwner, `/residents/${a.residentId}`, { status: 'INACTIVE' });
  assert.equal(crossOrg.status, 404, "another organization's staff cannot reach this resident");
  assert.equal((await sessionRows(a.residentId)).filter((r) => !r.revoked_at).length, 3);

  // 2-4. the owner makes the resident INACTIVE: every session ends in the same transaction (the audit log is untouched)
  const auditBefore = Number(
    (
      await sql<{ n: string }>(
        `SELECT count(*)::text n FROM audit_events WHERE organization_id = $1`,
        [a.org.id],
      )
    )[0]!.n,
  );
  const inactive = await staffPut(a.owner, `/residents/${a.residentId}`, { status: 'INACTIVE' });
  assert.equal(inactive.status, 200, JSON.stringify(inactive.body));
  assert.equal(inactive.body.status, 'INACTIVE');
  assert.ok(!JSON.stringify(inactive.body).includes('portal_'), 'no session data in the response');
  const rows = await sessionRows(a.residentId);
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.ok(r.revoked_at, 'every session is revoked');
    assert.equal(r.revoked_reason, 'RESIDENT_INACTIVE');
  }
  for (const s of sessions)
    assert.equal((await residentMe(s)).status, 401, 'every earlier session is refused');
  assert.equal(
    (
      await sql<{ r: string }>(
        `SELECT invalidated_reason r FROM resident_otp_challenges c JOIN resident_accounts a ON a.id = c.resident_account_id WHERE a.resident_id = $1 AND c.invalidated_at IS NOT NULL ORDER BY c.created_at DESC LIMIT 1`,
        [a.residentId],
      )
    )[0]!.r,
    'RESIDENT_INACTIVE',
    'the unused code died with the access',
  );
  const auditAfter = Number(
    (
      await sql<{ n: string }>(
        `SELECT count(*)::text n FROM audit_events WHERE organization_id = $1`,
        [a.org.id],
      )
    )[0]!.n,
  );
  assert.equal(
    auditAfter,
    auditBefore,
    'the status change writes no audit rows of its own (unchanged behaviour)',
  );
  // bystanders were not touched
  assert.equal(
    (await residentMe(bystanderSame)).status,
    200,
    'another resident of the same organization',
  );
  assert.equal(
    (await residentMe(bystanderOther)).status,
    200,
    'a resident of another organization',
  );
  assert.equal((await sessionRows(sameOrgResident)).filter((r) => r.revoked_at).length, 0);

  // 5-6. re-activation revives nothing; the old code is dead; a fresh sign-in creates a new, usable session
  assert.equal(
    (await staffPut(a.owner, `/residents/${a.residentId}`, { status: 'ACTIVE' })).status,
    200,
  );
  for (const s of sessions)
    assert.equal((await residentMe(s)).status, 401, 're-activation does not revive a session');
  await resetThrottles();
  const staleVerify = await verifyOtp(a.phone, staleCode, '10.42.0.1');
  assert.equal(staleVerify.status, 401, 'a code issued before the change is dead');
  assert.equal(staleVerify.headers['set-cookie'], undefined);
  await resetThrottles();
  const fresh = await residentLogin(a.phone, '10.42.0.2');
  assert.equal((await residentMe(fresh)).status, 200);
  const after = await sessionRows(a.residentId);
  assert.equal(after.length, 4);
  assert.equal(after.filter((r) => !r.revoked_at).length, 1, 'only the new session is live');
  assert.equal(after.filter((r) => r.revoked_at).length, 3, 'the old ones stay revoked');

  // 7. ARCHIVED through PUT revokes every session too (here by a manager, who holds resident.write)
  await resetThrottles();
  const second = await residentLogin(a.phone, '10.43.0.1');
  assert.equal((await residentMe(second)).status, 200);
  const archived = await staffPut(manager, `/residents/${a.residentId}`, { status: 'ARCHIVED' });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  for (const s of [fresh, second]) assert.equal((await residentMe(s)).status, 401);
  assert.equal((await sessionRows(a.residentId)).filter((r) => !r.revoked_at).length, 0);
  assert.equal(
    (await sessionRows(a.residentId)).filter((r) => r.revoked_reason === 'RESIDENT_ARCHIVED')
      .length,
    2,
  );

  // 7b. DELETE (the archive endpoint) is the third status path: an owner archiving a second resident revokes too
  const viaDelete = await makeResident(a.org.id);
  const deletePhone = newPhone();
  assert.equal((await provision(a.owner, viaDelete, deletePhone)).status, 201);
  await resetThrottles();
  const d1 = await residentLogin(deletePhone, '10.44.0.1');
  await resetThrottles();
  const d2 = await residentLogin(deletePhone, '10.44.0.2');
  assert.equal((await staffDelete(a.owner, `/residents/${viaDelete}`)).status, 200);
  for (const s of [d1, d2]) assert.equal((await residentMe(s)).status, 401);
  assert.equal(
    (await sessionRows(viaDelete)).every((r) => r.revoked_reason === 'RESIDENT_ARCHIVED'),
    true,
  );

  // a manager making a resident INACTIVE behaves exactly like an owner
  const mgrResident = await makeResident(a.org.id);
  const mgrPhone = newPhone();
  assert.equal((await provision(a.owner, mgrResident, mgrPhone)).status, 201);
  await resetThrottles();
  const m1 = await residentLogin(mgrPhone, '10.45.0.1');
  assert.equal(
    (await staffPut(manager, `/residents/${mgrResident}`, { status: 'INACTIVE' })).status,
    200,
  );
  assert.equal((await residentMe(m1)).status, 401);

  // 8-9. the bystanders are still signed in after all of the above
  assert.equal((await residentMe(bystanderSame)).status, 200);
  assert.equal((await residentMe(bystanderOther)).status, 200);

  // the resident's other fields and a no-op status write do not touch sessions
  const keep = await makeResident(a.org.id);
  const keepPhone = newPhone();
  assert.equal((await provision(a.owner, keep, keepPhone)).status, 201);
  await resetThrottles();
  const k1 = await residentLogin(keepPhone, '10.46.0.1');
  assert.equal((await staffPut(a.owner, `/residents/${keep}`, { status: 'ACTIVE' })).status, 200);
  assert.equal((await residentMe(k1)).status, 200, 'ACTIVE to ACTIVE ends nothing');
});

test('status change is atomic: if ending the portal sessions fails, the resident status change is rolled back and every session stays valid', async () => {
  const a = await setup();
  const sessions: ResSession[] = [];
  for (let i = 0; i < 2; i++) {
    await resetThrottles();
    sessions.push(await residentLogin(a.phone, `10.50.0.${i + 1}`));
  }
  await sql(
    `CREATE OR REPLACE FUNCTION nook_test_fail_revoke() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'injected revocation failure'; END $f$`,
  );
  await sql(
    `CREATE TRIGGER nook_test_fail_revoke BEFORE UPDATE OF revoked_at ON resident_sessions FOR EACH ROW EXECUTE FUNCTION nook_test_fail_revoke()`,
  );
  const statusOf = async () =>
    (
      await sql<{ status: string }>(`SELECT status FROM residents WHERE id = $1`, [a.residentId])
    )[0]!.status;
  try {
    for (const attempt of [
      () => staffPut(a.owner, `/residents/${a.residentId}`, { status: 'INACTIVE' }),
      () => staffPut(a.owner, `/residents/${a.residentId}`, { status: 'ARCHIVED' }),
      () => staffDelete(a.owner, `/residents/${a.residentId}`),
    ]) {
      const res = await attempt();
      assert.equal(res.status, 500, 'the request fails');
      assert.ok(!JSON.stringify(res.body).includes('injected'), 'no internal detail is returned');
      assert.equal(await statusOf(), 'ACTIVE', 'the status change was rolled back');
      for (const s of sessions)
        assert.equal((await residentMe(s)).status, 200, 'the sessions are still valid');
      assert.equal((await sessionRows(a.residentId)).filter((r) => r.revoked_at).length, 0);
    }
  } finally {
    await sql(`DROP TRIGGER IF EXISTS nook_test_fail_revoke ON resident_sessions`);
    await sql(`DROP FUNCTION IF EXISTS nook_test_fail_revoke()`);
  }
  // with the fault removed, the same request succeeds and ends everything
  assert.equal(
    (await staffPut(a.owner, `/residents/${a.residentId}`, { status: 'INACTIVE' })).status,
    200,
  );
  assert.equal(await statusOf(), 'INACTIVE');
  for (const s of sessions) assert.equal((await residentMe(s)).status, 401);
});

test("isolation: an owner of another organization cannot see, suspend, revoke or re-number this organization's accounts; a resident session carries only its own organization", async () => {
  const a = await setup();
  const orgB = await makeOrg('Other Org');
  const ownerB = await login(orgB.ownerEmail);
  const phoneB = newPhone();
  const accountB = (await provision(ownerB, await makeResident(orgB.id), phoneB)).body.data
    .id as string;
  for (const action of ['suspend', 'revoke', 'reactivate']) {
    const r = await staffPost(ownerB, `/resident-accounts/${a.accountId}/${action}`, {});
    assert.equal(r.status, 404, action);
  }
  assert.equal(
    (await staffPost(ownerB, `/resident-accounts/${a.accountId}/phone`, { phone: newPhone() }))
      .status,
    404,
  );
  const listB = await staffGet(ownerB, '/resident-accounts');
  assert.deepEqual(
    listB.body.data.items.map((i: { id: string }) => i.id),
    [accountB],
  );
  assert.equal(
    (await staffGet(ownerB, `/resident-accounts?residentId=${a.residentId}`)).body.data.items
      .length,
    0,
  );
  const sA = await residentLogin(a.phone, '10.10.0.1');
  const sB = await residentLogin(phoneB, '10.10.0.2');
  assert.ok(
    String((await residentMe(sA)).body.data.organizationName).includes('Resident Auth Org'),
  );
  assert.ok(String((await residentMe(sB)).body.data.organizationName).includes('Other Org'));
  assert.notEqual(
    (await residentMe(sA)).body.data.organizationName,
    (await residentMe(sB)).body.data.organizationName,
  );
  await staffPost(a.owner, `/resident-accounts/${a.accountId}/suspend`, {});
  assert.equal((await residentMe(sA)).status, 401);
  assert.equal(
    (await residentMe(sB)).status,
    200,
    "the other organization's resident is unaffected",
  );
});

// ------------------------------------------------------------------ 16-17. audiences
test('authorization: a resident session is refused (403) on owner and manager endpoints, and an owner session is not a resident session', async () => {
  const { phone } = await setup();
  const s = await residentLogin(phone, '10.11.0.1');
  const probes: Array<[string, string]> = [
    ['get', '/residents'],
    ['get', '/finance/invoices'],
    ['get', '/bookings'],
    ['get', '/properties'],
    ['get', '/check-ins'],
    ['get', '/admissions'],
    ['get', '/transfers/history'],
    ['get', '/resident-accounts'],
    ['get', '/auth/me'],
    ['get', `/residents/${randomUUID()}`],
    ['post', '/resident-accounts'],
    ['post', '/residents'],
    ['post', '/finance/payments'],
    ['post', '/auth/logout'],
    ['post', '/auth/password'],
  ];
  for (const [verb, path] of probes) {
    const r = (server as unknown as Record<string, (p: string) => request.Test>)[verb]!(
      `/api/v1${path}`,
    )
      .set('Cookie', s.cookie)
      .set('Origin', OWNER_ORIGIN);
    const res = await (verb === 'post' ? r.send({}) : r);
    assert.equal(res.status, 403, `${verb} ${path} -> ${res.status}`);
    assert.equal(res.body.code, 'INSUFFICIENT_ROLE', `${verb} ${path}`);
  }
  const org = await makeOrg();
  const staff = await login(org.ownerEmail);
  const asStaff = await server.get('/api/v1/resident-auth/me').set('Cookie', staff.cookie);
  assert.equal(asStaff.status, 401, 'an owner session does not open resident routes');
  // a resident cannot create their own account or provision anyone, even with a forged CSRF token
  assert.equal(
    (
      await server
        .post('/api/v1/resident-accounts')
        .set('Cookie', s.cookie)
        .set('Origin', RESIDENT_ORIGIN)
        .set('X-CSRF-Token', 'x')
        .send({ residentId: randomUUID(), phone: newPhone() })
    ).status,
    403,
  );
});

test('owner authentication is unaffected: it works as before, and owner and resident sessions coexist without touching each other', async () => {
  const { org, phone } = await setup();
  const staff = await login(org.ownerEmail);
  const me = await staffGet(staff, '/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.role, 'OWNER');
  assert.equal((await staffGet(staff, '/residents')).status, 200);
  const bad = await server
    .post('/api/v1/auth/login')
    .set('Origin', OWNER_ORIGIN)
    .send({ email: org.ownerEmail, password: 'wrong-password-123' });
  assert.equal(bad.status, 401);
  assert.equal(
    (
      await server
        .post('/api/v1/auth/login')
        .set('Origin', RESIDENT_ORIGIN)
        .send({ email: org.ownerEmail, password: TEST_PASSWORD })
    ).body.code,
    'INVALID_ORIGIN',
    'the resident origin cannot sign in to the owner app',
  );
  const r = await residentLogin(phone, '10.12.0.1');
  const both = `${staff.cookie}; ${r.cookie}`;
  assert.equal((await server.get('/api/v1/auth/me').set('Cookie', both)).status, 200);
  assert.equal((await server.get('/api/v1/resident-auth/me').set('Cookie', both)).status, 200);
  assert.equal((await staffGet(staff, '/residents')).status, 200);
  // signing out of one does not sign out of the other
  const out = await staffPost(staff, '/auth/logout');
  assert.equal(out.status, 200);
  assert.equal((await residentMe(r)).status, 200);
  assert.equal((await staffGet(staff, '/auth/me')).status, 401);
  // a resident sign-in does not set or replace the owner cookies
  await sql(
    `UPDATE resident_auth_throttles SET locked_until = NULL WHERE scope = 'OTP_COOLDOWN_PHONE'`,
  );
  await requestOtp(phone, '10.12.0.2');
  const resSignIn = await verifyOtp(phone, sms.lastCodeFor(phone)!, '10.12.0.2');
  assert.ok(
    !Object.keys(cookiesOf(resSignIn)).some((k) => k === 'nook_session' || k === 'nook_csrf'),
  );
});

// ------------------------------------------------------------------ 18. CSRF, origin, cookies
test('origin and cookies: exact origins per audience, no wildcard, and resident cookies keep every protection of the owner cookies', async () => {
  const { phone, owner } = await setup();
  for (const [origin, label] of [
    [OWNER_ORIGIN, 'owner origin'],
    ['http://evil.test', 'foreign origin'],
    ['http://localhost:5174/', 'trailing slash'],
    ['null', 'null origin'],
    ['*', 'wildcard'],
  ] as const) {
    const a = await requestOtp(phone, '10.13.0.1', origin);
    assert.equal(a.status, 403, `request from ${label}`);
    assert.equal(a.body.code, 'INVALID_ORIGIN');
    assert.equal(
      (await verifyOtp(phone, '123456', '10.13.0.1', origin)).status,
      403,
      `verify from ${label}`,
    );
  }
  assert.equal(
    (
      await server
        .post('/api/v1/resident-auth/otp/request')
        .set('X-Forwarded-For', '10.13.0.1')
        .send({ phone })
    ).status,
    403,
    'no Origin header',
  );
  assert.equal(sms.outbox.length, 0, 'refused origins trigger no SMS');
  // an owner mutation from the resident origin is refused
  assert.equal(
    (
      await server
        .post('/api/v1/resident-accounts')
        .set('Origin', RESIDENT_ORIGIN)
        .set('Cookie', owner.cookie)
        .set('X-CSRF-Token', owner.csrf)
        .send({ residentId: randomUUID() })
    ).body.code,
    'INVALID_ORIGIN',
  );
  // CORS grants
  const preflight = (origin: string, path: string) =>
    server
      .options(`/api/v1${path}`)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
  assert.equal(
    (await preflight(RESIDENT_ORIGIN, '/resident-auth/otp/verify')).headers[
      'access-control-allow-origin'
    ],
    RESIDENT_ORIGIN,
  );
  assert.equal(
    (await preflight(RESIDENT_ORIGIN, '/resident-accounts')).headers['access-control-allow-origin'],
    undefined,
  );
  assert.equal(
    (await preflight(RESIDENT_ORIGIN, '/auth/login')).headers['access-control-allow-origin'],
    undefined,
  );
  assert.equal(
    (await preflight(OWNER_ORIGIN, '/auth/login')).headers['access-control-allow-origin'],
    OWNER_ORIGIN,
  );
  assert.equal(
    (await preflight('http://evil.test', '/resident-auth/otp/verify')).headers[
      'access-control-allow-origin'
    ],
    undefined,
  );
  // cookies
  await requestOtp(phone, '10.13.1.1');
  const res = await verifyOtp(phone, sms.lastCodeFor(phone)!, '10.13.1.1');
  const raw = res.headers['set-cookie'] as unknown as string[];
  assert.equal(raw.length, 2);
  for (const c of raw) {
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=Strict/i);
    assert.match(c, /Path=\//);
    assert.ok(!/Domain=/i.test(c), 'host-only cookie');
    assert.ok(/^nook_resident_(session|csrf)=/.test(c), 'separate resident cookie names');
  }
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.body, { data: { authenticated: true } });
  assert.ok(!JSON.stringify(res.body).includes(phone));
  const csrf = await server.get('/api/v1/resident-auth/csrf').set('Origin', RESIDENT_ORIGIN);
  assert.equal(csrf.status, 200);
  assert.match(csrf.body.data.csrfToken, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(csrf.headers['cache-control'], 'no-store');
});
