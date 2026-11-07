/* eslint-disable @typescript-eslint/no-explicit-any -- supertest bodies and parsed log lines are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { loadRuntimeConfig } from '../../src/config.js';
import { setErrorReporter } from '../../src/observability/error-reporter.js';
import { log } from '../../src/observability/json-logger.js';
import { withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// Structured logging, request ids and safe error responses, exercised through the real application and the same
// configureApp() that main.ts runs. The log is captured from the logger's sink.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'debug';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';
const DB_SECRET = 'dbpassword-that-must-not-leak';

@Controller('__test')
class TestFaultsController {
  @Get('boom')
  boom(): never {
    throw new Error(
      `connection to postgresql://nook_runtime:${DB_SECRET}@db.internal:5432/nook failed for resident asha@example.in phone 9000000001`,
    );
  }

  @Get('prisma')
  prisma(): never {
    const error = new Error(
      'Invalid `prisma.resident.create()` invocation:\n\n{ data: { firstName: "Asha", phone: "9000000001" } }\nUnique constraint failed',
    );
    error.name = 'PrismaClientKnownRequestError';
    (error as any).code = 'P2002';
    throw error;
  }
}

@Module({ imports: [AppModule], controllers: [TestFaultsController] })
class TestAppModule {}

let app: any;
let server: ReturnType<typeof request>;
let lines: string[] = [];
const entries = () => lines.map((l) => JSON.parse(l) as Record<string, any>);
const reported: Array<{ error: unknown; context: any }> = [];

interface Account {
  email: string;
  orgId: string;
  userId: string;
}
let passwordHash: string;
async function newAccount(): Promise<Account> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const email = `obs-${randomUUID()}@nook.test.invalid`;
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'Obs Test',now())`, [
      orgId,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Obs Tester',now())`,
      [userId, email, passwordHash],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'OWNER','ACTIVE')`,
      [randomUUID(), orgId, userId],
    );
    await c.query('COMMIT');
  });
  return { email, orgId, userId };
}

async function signIn(account: Account) {
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email: account.email, password: TEST_PASSWORD })
    .expect(200);
  const set = res.headers['set-cookie'] as unknown as string[];
  const session = set.find((c) => c.startsWith('nook_session='))!.split(';')[0]!;
  const csrf = set.find((c) => c.startsWith('nook_csrf='))!.split(';')[0]!;
  return {
    requestId: res.headers['x-request-id'] as string,
    headers: {
      Origin: ORIGIN,
      Cookie: `${session}; ${csrf}`,
      'x-csrf-token': csrf.slice('nook_csrf='.length),
    },
    csrfValue: csrf.slice('nook_csrf='.length),
    sessionValue: session.slice('nook_session='.length),
  };
}

test.before(async () => {
  passwordHash = await hashTestPassword();
  app = await NestFactory.create(TestAppModule, { abortOnError: true, logger: false });
  configureApp(app, loadRuntimeConfig());
  log.configure({ level: 'debug', sink: (line) => lines.push(line) });
  setErrorReporter({ capture: (error, context) => reported.push({ error, context }) });
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${app.getHttpServer().address().port}`);
});

test.after(async () => {
  setErrorReporter({ capture: () => {} });
  await app.close();
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ------------------------------------------------------------------------------ request ids

test('request id: every response carries one, whatever the outcome', async () => {
  const account = await newAccount();
  const s = await signIn(account);
  const responses = await Promise.all([
    server.get('/api/v1/health'), // 200
    server.get('/api/v1/residents'), // 401
    server.get('/api/v1/no-such-route'), // 404
    server
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{"email":'), // 400 malformed JSON
    server
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'x'.repeat(300_000) })), // 413
    server
      .post('/api/v1/enquiries')
      .set({ ...s.headers, 'x-csrf-token': 'wrong' })
      .send({}), // 403 CSRF
    server
      .options('/api/v1/enquiries')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST'), // preflight
    server.get('/api/v1/__test/boom'), // 500
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 401, 404, 400, 413, 403, 204, 500],
  );
  const ids = responses.map((r) => r.headers['x-request-id']);
  for (const id of ids) assert.match(String(id), UUID_RE);
  assert.equal(new Set(ids).size, ids.length, 'a different id for every request');
});

test('request id: a UUID sent by the caller is kept, junk is replaced, and the browser may read the header', async () => {
  const mine = randomUUID();
  const kept = await server.get('/api/v1/health').set('X-Request-Id', mine);
  assert.equal(kept.headers['x-request-id'], mine);
  for (const bad of ['not-a-uuid', 'x'.repeat(300), `${mine}-extra`, '<script>alert(1)</script>']) {
    const res = await server.get('/api/v1/health').set('X-Request-Id', bad);
    assert.match(String(res.headers['x-request-id']), UUID_RE);
    assert.notEqual(res.headers['x-request-id'], bad);
  }
  const cors = await server.get('/api/v1/health').set('Origin', ORIGIN);
  assert.match(String(cors.headers['access-control-expose-headers']), /X-Request-Id/i);
});

test('request id: the same id appears on the response, in the access log and on the audit event', async () => {
  const account = await newAccount();
  lines = [];
  const s = await signIn(account);
  const loginLine = entries().find((e) => e.path === '/api/v1/auth/login');
  assert.equal(loginLine?.requestId, s.requestId);
  const audit = await withMigratorClient((c) =>
    c.query(
      `SELECT request_id FROM audit_events WHERE actor_user_id = $1 AND action = 'auth.login.succeeded'`,
      [account.userId],
    ),
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(
    audit.rows[0].request_id,
    s.requestId,
    'an audit row can be traced to its HTTP request',
  );
});

// ------------------------------------------------------------------------------ access log

test('access log: one JSON line per request with method, path, status, duration, user and organisation', async () => {
  const account = await newAccount();
  const s = await signIn(account);
  lines = [];
  const res = await server
    .get('/api/v1/enquiries?search=Asha%20Rao&page=1')
    .set(s.headers)
    .expect(200);
  const access = entries().filter((e) => e.context === 'http');
  assert.equal(access.length, 1);
  const [entry] = access;
  assert.equal(entry!.level, 'info');
  assert.equal(entry!.message, 'request completed');
  assert.equal(entry!.method, 'GET');
  assert.equal(entry!.path, '/api/v1/enquiries');
  assert.equal(entry!.route, '/api/v1/enquiries');
  assert.equal(entry!.status, 200);
  assert.equal(typeof entry!.durationMs, 'number');
  assert.equal(entry!.userId, account.userId);
  assert.equal(entry!.organizationId, account.orgId);
  assert.equal(entry!.role, 'OWNER');
  assert.equal(entry!.requestId, res.headers['x-request-id']);
  assert.equal(entry!.service, 'nook-api');
  assert.deepEqual(entry!.queryKeys, ['search', 'page'], 'parameter names only');
  assert.ok(!lines.join('').includes('Asha'), 'query values are never logged');
});

test('access log: levels follow the status, and health checks stay quiet at info', async () => {
  lines = [];
  await server.get('/api/v1/residents'); // 401
  await server.get('/api/v1/__test/boom'); // 500
  await server.get('/api/v1/health'); // 200
  const http = entries().filter((e) => e.context === 'http');
  assert.equal(http.find((e) => e.status === 401)?.level, 'warn');
  assert.equal(http.find((e) => e.status === 500)?.level, 'error');
  assert.equal(http.find((e) => e.path === '/api/v1/health')?.level, 'debug');
});

test('logs never contain credentials: not the password, the session, the CSRF value, or the cookie header', async () => {
  const account = await newAccount();
  lines = [];
  await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email: account.email, password: 'a-wrong-password-value-123' })
    .expect(401);
  const s = await signIn(account);
  await server.get('/api/v1/enquiries').set(s.headers).expect(200);
  await server
    .post('/api/v1/enquiries')
    .set(s.headers)
    .send({
      firstName: 'Asha',
      lastName: 'Rao',
      phone: '9000000077',
      email: 'asha.private@example.in',
      notes: 'private note text',
    })
    .expect(201);
  await server
    .post('/api/v1/auth/password')
    .set(s.headers)
    .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-new-password-value-456-xyz' })
    .expect(200);
  const text = lines.join('\n');
  assert.ok(lines.length > 0);
  for (const secret of [
    'a-wrong-password-value-123',
    TEST_PASSWORD,
    'a-new-password-value-456-xyz',
    s.csrfValue,
    s.sessionValue,
    'nook_session=',
    'nook_csrf=',
    'Asha',
    '9000000077',
    'asha.private@example.in',
    'private note text',
    account.email,
  ]) {
    assert.ok(!text.includes(secret), `the log contains ${secret.slice(0, 12)}…`);
  }
  for (const line of lines) JSON.parse(line); // every line is valid JSON
});

// ------------------------------------------------------------------------------ errors

test('errors: an unexpected exception returns a safe 500 with the request id and nothing else', async () => {
  lines = [];
  reported.length = 0;
  const res = await server.get('/api/v1/__test/boom');
  assert.equal(res.status, 500);
  const id = res.headers['x-request-id'];
  assert.deepEqual(res.body, { statusCode: 500, message: 'Internal server error', requestId: id });
  const clientText = res.text;
  for (const leak of [
    DB_SECRET,
    'postgresql',
    'asha@',
    '9000000001',
    'db.internal',
    'Error:',
    ' at ',
    '.ts',
    'node_modules',
  ]) {
    assert.ok(!clientText.includes(leak), `the response leaked ${leak}`);
  }
  assert.match(String(res.headers['content-type']), /json/);

  const error = entries().find((e) => e.message === 'unhandled exception');
  assert.ok(error, 'the failure is in the log');
  assert.equal(error!.level, 'error');
  assert.equal(error!.requestId, id);
  assert.equal(error!.path, '/api/v1/__test/boom');
  assert.ok(
    error!.err.stack.length > 0 && error!.err.stack.every((f: string) => f.startsWith('at ')),
  );
  const text = lines.join('\n');
  for (const secret of [DB_SECRET, 'asha@example.in', '9000000001']) {
    assert.ok(!text.includes(secret), `the log leaked ${secret}`);
  }
  assert.equal(reported.length, 1, 'the error reporter was told');
  assert.equal(reported[0]!.context.requestId, id);
  assert.equal(reported[0]!.context.status, 500);
});

test('errors: a database-client error never puts its query values in the response or the log', async () => {
  lines = [];
  const res = await server.get('/api/v1/__test/prisma');
  assert.equal(res.status, 500);
  assert.deepEqual(Object.keys(res.body).sort(), ['message', 'requestId', 'statusCode']);
  const text = `${res.text}\n${lines.join('\n')}`;
  assert.ok(!text.includes('Asha') && !text.includes('9000000001'));
  const error = entries().find((e) => e.message === 'unhandled exception');
  assert.equal(error!.err.code, 'P2002');
  assert.equal(error!.err.name, 'PrismaClientKnownRequestError');
});

test('errors: deliberate client errors keep their exact bodies (nothing existing changes)', async () => {
  const unauthenticated = await server.get('/api/v1/residents');
  assert.deepEqual(unauthenticated.body, { code: 'UNAUTHENTICATED' });
  const missing = await server.get('/api/v1/no-such-route');
  assert.deepEqual(missing.body, {
    message: 'Cannot GET /api/v1/no-such-route',
    error: 'Not Found',
    statusCode: 404,
  });
  const account = await newAccount();
  const s = await signIn(account);
  const bad = await server.get('/api/v1/residents/not-a-uuid').set(s.headers);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.statusCode, 400);
  const csrf = await server
    .post('/api/v1/enquiries')
    .set({ ...s.headers, 'x-csrf-token': 'wrong' })
    .send({});
  assert.deepEqual(csrf.body, { code: 'INVALID_CSRF_TOKEN' });
  const health = await server.get('/api/v1/health/database');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok', dependency: 'database' });
  // a client error is not an "unhandled exception"
  lines = [];
  await server.get('/api/v1/residents/not-a-uuid').set(s.headers);
  assert.ok(!entries().some((e) => e.message === 'unhandled exception'));
});

test('errors: a malformed or oversized body is a clean JSON 4xx, with no parser internals or stack', async () => {
  const malformed = await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .set('Content-Type', 'application/json')
    .send('{"email": ');
  assert.equal(malformed.status, 400);
  assert.match(String(malformed.headers['content-type']), /json/);
  assert.ok(!/<html|<pre>|node_modules|\bat \w/i.test(malformed.text));
  const huge = await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ email: 'x'.repeat(300_000) }));
  assert.equal(huge.status, 413);
  assert.ok(!/<html|<pre>|node_modules/i.test(huge.text));
});

test('behaviour preserved: sessions, CSRF and tenant scoping still work with the new middleware', async () => {
  const a = await newAccount();
  const b = await newAccount();
  const sa = await signIn(a);
  const sb = await signIn(b);
  const created = await server
    .post('/api/v1/enquiries')
    .set(sa.headers)
    .send({ firstName: 'Tenant', lastName: 'A', phone: '9000000088' })
    .expect(201);
  await server.get(`/api/v1/enquiries/${created.body.id}`).set(sb.headers).expect(404);
  await server.get(`/api/v1/enquiries/${created.body.id}`).set(sa.headers).expect(200);
  await server
    .post('/api/v1/enquiries')
    .set({ ...sa.headers, 'x-csrf-token': 'wrong' })
    .send({})
    .expect(403);
  await server.post('/api/v1/auth/logout').set(sa.headers).expect(200);
  await server.get('/api/v1/auth/me').set(sa.headers).expect(401);
});

// ------------------------------------------------------------------------------ Sentry through the real app

test('Sentry: an unexpected 500 is reported with its request id; client errors are not; nothing sensitive is sent', async () => {
  const { initSentryReporter } = await import('../../src/observability/sentry-reporter.js');
  const envelopes: any[] = [];
  const sentry = initSentryReporter({
    dsn: 'https://examplePublicKey@o0.ingest.sentry.test/1234567',
    environment: 'test',
    release: 'integration',
    transport: (() => ({
      send: async (envelope: any) => {
        envelopes.push(envelope);
        return {};
      },
      flush: async () => true,
    })) as any,
  });
  setErrorReporter(sentry);
  try {
    const account = await newAccount();
    const s = await signIn(account);
    // client errors: 401, 404, 400, 403 -> nothing reported
    await server.get('/api/v1/residents');
    await server.get('/api/v1/no-such-route');
    await server.get('/api/v1/residents/not-a-uuid').set(s.headers);
    await server
      .post('/api/v1/enquiries')
      .set({ ...s.headers, 'x-csrf-token': 'wrong' })
      .send({});
    await sentry.flush!(2000);
    assert.equal(envelopes.length, 0, 'client errors are not reported');

    const res = await server.get('/api/v1/__test/boom').set(s.headers);
    assert.equal(res.status, 500);
    await sentry.flush!(2000);
    const events = envelopes.flatMap((e) =>
      e[1].filter(([h]: any) => h.type === 'event').map(([, p]: any) => p),
    );
    assert.equal(events.length, 1);
    assert.equal(
      events[0].tags.requestId,
      res.headers['x-request-id'],
      'the Sentry issue links to the log line',
    );
    assert.equal(events[0].tags.status, '500');
    assert.equal(events[0].transaction, 'GET /api/v1/__test/boom');
    const text = JSON.stringify(envelopes);
    for (const secret of [
      DB_SECRET,
      'asha@example.in',
      '9000000001',
      'db.internal',
      s.csrfValue,
      s.sessionValue,
      'nook_session',
      account.email,
    ]) {
      assert.ok(!text.includes(secret), `Sentry received ${secret}`);
    }
  } finally {
    setErrorReporter({ capture: (error, context) => reported.push({ error, context }) });
    await sentry.close();
  }
});
