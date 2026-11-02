/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies and pg rows are untyped */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// R1 throttling, R2 audit trail, R4 password change, R3/R5/R6 operator scripts.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';
const run = promisify(execFile);

let app: any;
let server: ReturnType<typeof request>;
let passwordHash: string;

async function boot() {
  const instance = await NestFactory.create(AppModule, { abortOnError: true, logger: false });
  instance.setGlobalPrefix('api/v1');
  instance.getHttpAdapter().getInstance().set('trust proxy', true); // lets each test choose its own client address
  await instance.init();
  await instance.listen(0);
  return instance;
}
const urlOf = (a: any) => `http://localhost:${a.getHttpServer().address().port}`;

test.before(async () => {
  passwordHash = await hashTestPassword();
  app = await boot();
  server = request(urlOf(app));
});
test.after(async () => {
  await app.close();
});

interface Account {
  orgId: string;
  userId: string;
  email: string;
  ip: string;
}
const nextIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function newAccount(opts: { mustChange?: boolean } = {}): Promise<Account> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const email = `sec-${randomUUID()}@nook.test.invalid`;
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
      orgId,
      `Sec ${orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, password_change_required, updated_at) VALUES ($1,$2,$3,'Sec Tester',$4,now())`,
      [userId, email, passwordHash, Boolean(opts.mustChange)],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'OWNER','ACTIVE')`,
      [randomUUID(), orgId, userId],
    );
    await c.query('COMMIT');
  });
  return { orgId, userId, email, ip: nextIp() };
}
const login = (a: Account, password = TEST_PASSWORD, target = server, email = a.email) =>
  target
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', a.ip)
    .send({ email, password });
function cookiesOf(res: any) {
  const set = res.headers['set-cookie'] as string[];
  const session = set.find((c) => c.startsWith('nook_session='))!.split(';')[0]!;
  const csrf = set.find((c) => c.startsWith('nook_csrf='))!.split(';')[0]!;
  return {
    Cookie: `${session}; ${csrf}`,
    'x-csrf-token': csrf.slice('nook_csrf='.length),
    Origin: ORIGIN,
  };
}
const events = (userId: string, action: string) =>
  withMigratorClient(
    async (c) =>
      (
        await c.query(
          `SELECT * FROM audit_events WHERE action = $1 AND (actor_user_id = $2::uuid OR target_id = $2::text) ORDER BY occurred_at`,
          [action, userId],
        )
      ).rows,
  );
const throttleRows = () =>
  withMigratorClient(async (c) => (await c.query(`SELECT * FROM login_throttles`)).rows);

// ------------------------------------------------------------------ R1 throttling

test('R1: five wrong passwords lock the account; even the right password is then refused (429)', async () => {
  const a = await newAccount();
  for (let i = 0; i < 5; i += 1) await login(a, 'wrong-password-' + i).expect(401);
  const locked = await login(a).expect(429);
  assert.equal(locked.body.code, 'RATE_LIMITED');
  assert.ok(locked.body.retryAfterSeconds > 0 && locked.body.retryAfterSeconds <= 15 * 60 + 1);
  assert.equal(locked.headers['set-cookie'], undefined, 'no session is issued while locked');
});

test('R1: an unknown e-mail is throttled identically, so lockout reveals nothing about which accounts exist', async () => {
  const a = await newAccount();
  const ghost = `ghost-${randomUUID()}@nook.test.invalid`;
  for (let i = 0; i < 5; i += 1) await login(a, 'x'.repeat(14), server, ghost).expect(401);
  const locked = await login(a, 'x'.repeat(14), server, ghost).expect(429);
  assert.equal(locked.body.code, 'RATE_LIMITED');
  const real = await newAccount();
  for (let i = 0; i < 5; i += 1) await login(real, 'x'.repeat(14)).expect(401);
  const lockedReal = await login(real, 'x'.repeat(14)).expect(429);
  assert.deepEqual(
    Object.keys(lockedReal.body).sort(),
    Object.keys(locked.body).sort(),
    'same response shape',
  );
});

test('R1: throttle state is persisted (survives an API restart) and stores only hashes', async () => {
  const a = await newAccount();
  for (let i = 0; i < 5; i += 1) await login(a, 'nope-nope-nope').expect(401);
  const second = await boot(); // a brand-new API instance: nothing is held in memory
  try {
    await login(a, TEST_PASSWORD, request(urlOf(second))).expect(429);
  } finally {
    await second.close();
  }
  const rows = await throttleRows();
  assert.ok(rows.length > 0);
  for (const row of rows) assert.match(row.key_hash, /^[0-9a-f]{64}$/);
  assert.ok(
    !JSON.stringify(rows).includes(a.email) && !JSON.stringify(rows).includes(a.ip),
    'no e-mail or IP address is stored',
  );
});

test('R1: the lock expires, and a successful sign-in resets the failure counter', async () => {
  const a = await newAccount();
  for (let i = 0; i < 5; i += 1) await login(a, 'nope-nope-nope').expect(401);
  await login(a).expect(429);
  await withMigratorClient((c) =>
    c.query(
      `UPDATE login_throttles SET locked_until = now() - interval '1 minute', window_started_at = now() - interval '20 minutes' WHERE scope = 'IDENTIFIER'`,
    ),
  );
  await login(a).expect(200);
  // 4 failures, a success, then 4 more failures: still not locked, because success reset the counter
  for (let i = 0; i < 4; i += 1) await login(a, 'nope-nope-nope').expect(401);
  await login(a).expect(200);
  for (let i = 0; i < 4; i += 1) await login(a, 'nope-nope-nope').expect(401);
  await login(a).expect(200);
});

test('R1: one source address is limited across many accounts; other addresses are unaffected', async () => {
  const ip = nextIp();
  for (let i = 0; i < 20; i += 1) {
    await server
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({
        email: `spray-${i}-${randomUUID()}@nook.test.invalid`,
        password: 'spraying-passwords',
      })
      .expect(401);
  }
  const victim = await newAccount();
  await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', ip)
    .send({ email: victim.email, password: TEST_PASSWORD })
    .expect(429);
  await login(victim).expect(200); // the same account from its own address still works
});

test('R1: concurrent wrong attempts are counted exactly (no lost updates)', async () => {
  const a = await newAccount();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => login(a, 'wrong-wrong-wrong')),
  );
  assert.ok(
    results.filter((r) => r.status === 401).length >= 5,
    'at least the first five are normal failures',
  );
  const row = (await throttleRows()).find((r) => r.scope === 'IDENTIFIER' && r.locked_until);
  assert.ok(row, 'the account ended up locked');
  await login(a).expect(429);
});

// ------------------------------------------------------------------ R2 audit trail

test('R2: sign-in success, failure, throttling and sign-out are audited without any secret', async () => {
  const a = await newAccount();
  await login(a, 'definitely-wrong').expect(401);
  const ok = await login(a).expect(200);
  const auth = cookiesOf(ok);
  await server.post('/api/v1/auth/logout').set(auth).expect(200);
  for (let i = 0; i < 5; i += 1) await login(a, 'definitely-wrong').expect(401);
  await login(a).expect(429);
  const ghost = `ghost-${randomUUID()}@nook.test.invalid`;
  await login(a, 'definitely-wrong', server, ghost).expect(401);

  assert.equal((await events(a.userId, 'auth.login.failed')).length, 6);
  const succeeded = await events(a.userId, 'auth.login.succeeded');
  assert.equal(succeeded.length, 1);
  assert.equal(succeeded[0].organization_id, a.orgId);
  assert.equal((await events(a.userId, 'auth.logout')).length, 1);
  const unknown = await withMigratorClient(
    async (c) =>
      (
        await c.query(
          `SELECT * FROM audit_events WHERE action IN ('auth.login.failed','auth.login.throttled') AND actor_user_id IS NULL ORDER BY occurred_at DESC LIMIT 20`,
        )
      ).rows,
  );
  assert.ok(
    unknown.some((r: any) => /^[0-9a-f]{12}$/.test(r.metadata.identifier)),
    'unknown identifiers appear only as a short one-way tag',
  );
  const all = JSON.stringify(
    await withMigratorClient(
      async (c) =>
        (
          await c.query(
            `SELECT metadata FROM audit_events WHERE action LIKE 'auth.%' AND (actor_user_id = $1 OR actor_user_id IS NULL)`,
            [a.userId],
          )
        ).rows,
    ),
  );
  for (const secret of [TEST_PASSWORD, 'definitely-wrong', passwordHash, a.email, ghost, a.ip]) {
    assert.ok(
      !all.includes(secret),
      'audit metadata contains no password, hash, e-mail address or IP address',
    );
  }
});

// ------------------------------------------------------------------ R4 change own password

const NEW_PASSWORD = 'a-much-longer-passphrase-1';
const change = (auth: any, body: object) =>
  server.post('/api/v1/auth/password').set(auth).send(body);

test('R4: the new password must be at least 12 characters and different; nothing changes when rejected', async () => {
  const a = await newAccount();
  const auth = cookiesOf(await login(a).expect(200));
  const before = await withMigratorClient(
    async (c) =>
      (await c.query(`SELECT password_hash FROM users WHERE id = $1`, [a.userId])).rows[0]
        .password_hash,
  );
  for (const [newPassword, reason] of [
    ['short-11-ch', 'TOO_SHORT'],
    [TEST_PASSWORD, 'SAME_AS_CURRENT'],
    [a.email, 'SAME_AS_IDENTIFIER'],
    ['x'.repeat(129), 'TOO_LONG'],
  ] as const) {
    const res = await change(auth, { currentPassword: TEST_PASSWORD, newPassword });
    assert.equal(res.status, 400, `${reason}: ${res.status}`);
    assert.equal(res.body.code, 'NEW_PASSWORD_REJECTED');
    assert.equal(res.body.reason, reason);
  }
  await change(auth, { currentPassword: TEST_PASSWORD, newPassword: 12345678901234 }).expect(400);
  await change(auth, { newPassword: NEW_PASSWORD }).expect(400);
  assert.equal(
    await withMigratorClient(
      async (c) =>
        (await c.query(`SELECT password_hash FROM users WHERE id = $1`, [a.userId])).rows[0]
          .password_hash,
    ),
    before,
  );
});

test('R4: a wrong current password is refused, audited, and throttled after five tries', async () => {
  const a = await newAccount();
  const auth = cookiesOf(await login(a).expect(200));
  for (let i = 0; i < 5; i += 1) {
    const res = await change(auth, {
      currentPassword: 'not-my-password-' + i,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'CURRENT_PASSWORD_INVALID');
  }
  await change(auth, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }).expect(429);
  assert.equal((await events(a.userId, 'auth.password.change_failed')).length, 5);
});

test('R4: a successful change works immediately, revokes every OTHER session and keeps this one', async () => {
  const a = await newAccount();
  const here = cookiesOf(await login(a).expect(200));
  const other = cookiesOf(await login(a).expect(200));
  assert.equal((await server.get('/api/v1/auth/me').set(other)).status, 200);
  const res = await change(here, {
    currentPassword: TEST_PASSWORD,
    newPassword: NEW_PASSWORD,
  }).expect(200);
  assert.equal(res.body.data.otherSessionsRevoked, 1);
  assert.equal(
    (await server.get('/api/v1/auth/me').set(other)).status,
    401,
    'the other device is signed out',
  );
  assert.equal(
    (await server.get('/api/v1/auth/me').set(here)).status,
    200,
    'this session continues',
  );
  await login(a, TEST_PASSWORD).expect(401);
  await login(a, NEW_PASSWORD).expect(200);
  const audited = await events(a.userId, 'auth.password.changed');
  assert.equal(audited.length, 1);
  assert.equal(audited[0].metadata.revokedOtherSessions, 1);
  assert.ok(!JSON.stringify(audited[0].metadata).includes(NEW_PASSWORD));
});

test('R4: changing the password requires a session, the Origin check and the CSRF token', async () => {
  const a = await newAccount();
  const auth = cookiesOf(await login(a).expect(200));
  const body = { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD };
  assert.equal(
    (await server.post('/api/v1/auth/password').set('Origin', ORIGIN).send(body)).status,
    401,
  );
  assert.equal(
    (
      await server
        .post('/api/v1/auth/password')
        .set({ ...auth, 'x-csrf-token': 'mismatch' })
        .send(body)
    ).status,
    403,
  );
  assert.equal(
    (
      await server
        .post('/api/v1/auth/password')
        .set({ ...auth, Origin: 'https://evil.example' })
        .send(body)
    ).status,
    403,
  );
  await login(a, TEST_PASSWORD).expect(200); // still the old password
});

test('R4: a temporary password blocks everything except the account endpoints until it is changed', async () => {
  const a = await newAccount({ mustChange: true });
  const res = await login(a).expect(200);
  assert.equal(res.body.data.user.passwordChangeRequired, true);
  const auth = cookiesOf(res);
  const blocked = await server.get('/api/v1/finance/invoices').set(auth);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await server.get('/api/v1/residents').set(auth)).status, 403);
  assert.equal(
    (await server.get('/api/v1/auth/me').set(auth)).body.data.user.passwordChangeRequired,
    true,
  );
  await change(auth, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }).expect(200);
  assert.equal(
    (await server.get('/api/v1/auth/me').set(auth)).body.data.user.passwordChangeRequired,
    false,
  );
  assert.equal(
    (await server.get('/api/v1/finance/invoices').set(auth)).status,
    200,
    'the same session now works normally',
  );
});

// ------------------------------------------------------------------ R3 / R5 / R6 operator scripts

const target = (() => {
  const u = new URL(process.env.MIGRATOR_DATABASE_URL!);
  return `${u.hostname}:${u.port}/${u.pathname.slice(1)}`;
})();
const ROOT = new URL('../../../../', import.meta.url).pathname;
async function ops(script: string, args: string[], confirm: string | null = target) {
  const full = [
    ...['--import', 'tsx', `scripts/ops/${script}.ts`],
    ...args,
    ...(confirm ? ['--confirm-target', confirm] : []),
  ];
  try {
    const { stdout, stderr } = await run('node', full, {
      cwd: ROOT,
      env: process.env,
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (e: any) {
    return {
      code: e.code as number,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
    };
  }
}
const tempFrom = (stdout: string) => stdout.match(/^\s{3}(\S{20})\s*$/m)?.[1];

test('R3: provisioning creates organization, user and membership, shows a random temporary password once, and stores only a hash', async () => {
  const email = `owner-${randomUUID()}@pilot.test.invalid`;
  const res = await ops('provision-user', [
    '--email',
    email,
    '--name',
    'Pilot Owner',
    '--role',
    'OWNER',
    '--create-org',
    `Pilot ${randomUUID().slice(0, 6)}`,
  ]);
  assert.equal(res.code, 0, res.stderr);
  const temp = tempFrom(res.stdout);
  assert.ok(temp && temp.length === 20, 'a 20-character temporary password is displayed');
  assert.ok(!res.stderr.includes(temp!), 'not repeated on stderr');
  assert.ok(
    !(res.stdout + res.stderr).includes(
      process.env.MIGRATOR_DATABASE_URL!.split('@')[0]!.split(':')[2]!,
    ),
    'the database credential is never printed',
  );
  const rows = await withMigratorClient(async (c) => ({
    user: (
      await c.query(
        `SELECT id, password_hash, password_change_required, status FROM users WHERE login_identifier = $1`,
        [email],
      )
    ).rows[0],
    members: (
      await c.query(
        `SELECT m.role, m.status FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.login_identifier = $1`,
        [email],
      )
    ).rows,
  }));
  assert.equal(rows.user.password_change_required, true);
  assert.match(rows.user.password_hash, /^scrypt\$/);
  assert.notEqual(rows.user.password_hash, temp);
  assert.deepEqual(rows.members, [{ role: 'OWNER', status: 'ACTIVE' }]);
  const dump = await withMigratorClient(async (c) =>
    JSON.stringify(
      (await c.query(`SELECT * FROM audit_events WHERE target_id = $1`, [rows.user.id])).rows,
    ),
  );
  assert.ok(
    dump.includes('auth.user.provisioned') && dump.includes('ops-script') && !dump.includes(temp!),
    'audited, and the temporary password is nowhere in the audit trail',
  );
  const first = await login({ email, ip: nextIp() } as Account, temp!).expect(200);
  assert.equal(
    first.body.data.user.passwordChangeRequired,
    true,
    'the temporary password forces a change',
  );
  assert.equal(first.body.data.user.role, 'OWNER');
  // an existing e-mail is refused rather than overwritten
  const again = await ops('provision-user', [
    '--email',
    email,
    '--name',
    'Pilot Owner',
    '--role',
    'OWNER',
    '--create-org',
    'Another',
  ]);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already exists/);
});

test('R3: the scripts refuse a missing or wrong target, a bad role and ambiguous organization arguments, changing nothing', async () => {
  const email = `refused-${randomUUID()}@pilot.test.invalid`;
  const base = ['--email', email, '--name', 'X', '--role', 'OWNER', '--create-org', 'Refused Org'];
  assert.equal((await ops('provision-user', base, null)).code, 2);
  const wrong = await ops('provision-user', base, '127.0.0.1:5999/other');
  assert.equal(wrong.code, 2);
  assert.match(wrong.stderr, /does not match/);
  assert.equal(
    (
      await ops('provision-user', [
        '--email',
        email,
        '--name',
        'X',
        '--role',
        'ROOT',
        '--create-org',
        'Refused Org',
      ])
    ).code,
    2,
  );
  assert.equal(
    (await ops('provision-user', ['--email', email, '--name', 'X', '--role', 'OWNER'])).code,
    2,
  );
  assert.equal(
    (
      await ops('provision-user', [
        '--email',
        'not-an-email',
        '--name',
        'X',
        '--role',
        'OWNER',
        '--create-org',
        'Refused Org',
      ])
    ).code,
    2,
  );
  assert.equal(
    await withMigratorClient(async (c) =>
      Number(
        (await c.query(`SELECT count(*) n FROM users WHERE login_identifier = $1`, [email])).rows[0]
          .n,
      ),
    ),
    0,
  );
  assert.equal(
    await withMigratorClient(async (c) =>
      Number(
        (await c.query(`SELECT count(*) n FROM organizations WHERE name = 'Refused Org'`)).rows[0]
          .n,
      ),
    ),
    0,
  );
});

test('R5: an operator reset ends every session, clears a lock, and the new temporary password must be changed', async () => {
  const a = await newAccount();
  const live = cookiesOf(await login(a).expect(200));
  for (let i = 0; i < 5; i += 1) await login(a, 'nope-nope-nope').expect(401);
  await login(a).expect(429);
  const res = await ops('reset-password', ['--email', a.email]);
  assert.equal(res.code, 0, res.stderr);
  const temp = tempFrom(res.stdout)!;
  assert.equal(temp.length, 20);
  assert.equal(
    (await server.get('/api/v1/auth/me').set(live)).status,
    401,
    'the live session ended at once',
  );
  const fresh = await login(a, temp).expect(200);
  assert.equal(fresh.body.data.user.passwordChangeRequired, true);
  await login({ ...a, ip: nextIp() }, TEST_PASSWORD).expect(401);
  const audited = await events(a.userId, 'auth.password.reset');
  assert.equal(audited.length, 1);
  assert.ok(
    audited[0].metadata.revokedSessions >= 1 && !JSON.stringify(audited[0].metadata).includes(temp),
  );
  assert.equal(
    (await ops('reset-password', ['--email', `nobody-${randomUUID()}@pilot.test.invalid`])).code,
    2,
  );
});

test('R6: revoking access ends the membership and the live session immediately, and the person can no longer sign in', async () => {
  const a = await newAccount();
  const live = cookiesOf(await login(a).expect(200));
  assert.equal((await server.get('/api/v1/auth/me').set(live)).status, 200);
  const res = await ops('revoke-access', ['--email', a.email]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(
    (await server.get('/api/v1/auth/me').set(live)).status,
    401,
    'immediate, not at session expiry',
  );
  await login(a).expect(401);
  const m = await withMigratorClient(
    async (c) =>
      (await c.query(`SELECT status, revoked_at FROM memberships WHERE user_id = $1`, [a.userId]))
        .rows[0],
  );
  assert.equal(m.status, 'REVOKED');
  assert.ok(m.revoked_at);
  const s = await withMigratorClient(
    async (c) =>
      (
        await c.query(
          `SELECT revoked_reason FROM sessions WHERE user_id = $1 AND revoked_reason = 'access_revoked'`,
          [a.userId],
        )
      ).rowCount,
  );
  assert.ok(s! >= 1);
  assert.equal((await events(a.userId, 'auth.access.revoked')).length, 1);
  assert.equal(
    (await ops('revoke-access', ['--email', a.email])).code,
    2,
    'a second revoke is refused',
  );
});

test('R6: revoking one person leaves everyone else in the organization untouched', async () => {
  const keep = await newAccount();
  const orgId = keep.orgId;
  const leaverEmail = `leaver-${randomUUID()}@nook.test.invalid`;
  const leaverId = randomUUID();
  await withMigratorClient(async (c) => {
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Leaver',now())`,
      [leaverId, leaverEmail, passwordHash],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'PROPERTY_MANAGER','ACTIVE')`,
      [randomUUID(), orgId, leaverId],
    );
  });
  const keepSession = cookiesOf(await login(keep).expect(200));
  assert.equal((await ops('revoke-access', ['--email', leaverEmail])).code, 0);
  assert.equal((await server.get('/api/v1/auth/me').set(keepSession)).status, 200);
  await login(keep).expect(200);
});
