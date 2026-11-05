/* eslint-disable @typescript-eslint/no-explicit-any -- Sentry envelopes and events are untyped here */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import * as Sentry from '@sentry/node';
import { loadRuntimeConfig, parseSentryDsn, parseSentryEnvironment } from '../src/config.js';
import {
  routeName,
  sanitizedError,
  scrubEvent,
  initSentryReporter,
} from '../src/observability/sentry-reporter.js';

const DSN = 'https://examplePublicKey@o0.ingest.sentry.test/1234567';
const UUID = '3f2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e6f';
const ORG = '9a2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e70';

/** A transport that keeps every envelope in memory: no network is ever used. */
function memoryTransport() {
  const envelopes: any[] = [];
  const transport = () => ({
    send: async (envelope: any) => {
      envelopes.push(envelope);
      return {};
    },
    flush: async () => true,
  });
  const events = () =>
    envelopes.flatMap((e) =>
      (e[1] as any[]).filter(([h]) => h.type === 'event').map(([, payload]) => payload),
    );
  return { transport: transport as any, envelopes, events };
}

let current: { close(): Promise<boolean> } | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

function start(release: string | undefined = 'abc1234') {
  const memory = memoryTransport();
  const reporter = initSentryReporter({
    dsn: DSN,
    environment: 'production',
    release,
    transport: memory.transport,
  });
  current = reporter;
  return { reporter, ...memory };
}

test('an unexpected error is reported with its request id, route, status, user id and organisation id', async () => {
  const { reporter, events } = start();
  reporter.capture(new TypeError('cannot read properties of undefined'), {
    requestId: UUID,
    method: 'POST',
    path: `/api/v1/finance/invoices/${UUID}/issue?x=Asha`,
    status: 500,
    userId: ORG,
    organizationId: ORG,
  });
  await reporter.flush!(2000);
  const [event] = events();
  assert.ok(event, 'an event was sent');
  assert.equal(event.level, 'error');
  assert.equal(event.environment, 'production');
  assert.equal(event.release, 'abc1234');
  assert.equal(event.exception.values[0].type, 'TypeError');
  assert.deepEqual(event.tags, {
    requestId: UUID,
    method: 'POST',
    status: '500',
    organizationId: ORG,
  });
  assert.equal(event.transaction, 'POST /api/v1/finance/invoices/:id/issue');
  assert.deepEqual(event.user, { id: ORG }, 'the user is an opaque id and nothing else');
  assert.ok(event.exception.values[0].stacktrace.frames.length > 0, 'the stack frames are kept');
});

test('no personal or request data is collected: no request, cookies, headers, IP, breadcrumbs or server name', async () => {
  const { reporter, events, envelopes } = start();
  reporter.capture(new Error('boom'), { requestId: UUID, status: 500, userId: ORG });
  await reporter.flush!(2000);
  const [event] = events();
  assert.equal(event.request, undefined);
  assert.equal(event.server_name, undefined);
  assert.equal(event.user.ip_address, undefined);
  assert.equal(event.user.email, undefined);
  assert.equal(event.user.username, undefined);
  assert.deepEqual(event.breadcrumbs ?? [], []);
  assert.equal(event.modules, undefined);
  const text = JSON.stringify(envelopes);
  assert.ok(!/cookie|authorization|set-cookie|x-csrf|nook_session/i.test(text));
  // only the (empty-ish) error event goes out: no sessions, transactions or profiles
  const kinds = envelopes.flatMap((e: any) => e[1].map(([h]: any) => h.type));
  assert.deepEqual([...new Set(kinds)], ['event']);
});

test('the SDK is configured privacy-first: no default integrations, no PII, no tracing', async () => {
  const { reporter } = start();
  const options = Sentry.getClient()!.getOptions() as any;
  assert.equal(options.sendDefaultPii, false);
  assert.equal(options.defaultIntegrations, false);
  assert.equal(options.tracesSampleRate, 0);
  assert.equal(options.maxBreadcrumbs, 0);
  assert.equal(options.skipOpenTelemetrySetup, true);
  const names = [
    'Http',
    'NodeFetch',
    'Console',
    'Context',
    'LocalVariables',
    'RequestData',
    'OnUncaughtException',
    'OnUnhandledRejection',
  ];
  for (const name of names) {
    assert.equal(
      Sentry.getClient()!.getIntegrationByName(name),
      undefined,
      `${name} must not be installed`,
    );
  }
  void reporter;
});

test('secrets inside an error message never leave the process', async () => {
  const { reporter, events, envelopes } = start();
  reporter.capture(
    new Error(
      'connect failed postgresql://nook:topsecretpw@db.internal/nook for asha@example.in phone 9000000001 Bearer abc.def.ghi password=hunter2hunter2 nook_session=AbCdEf',
    ),
    { requestId: UUID, status: 500 },
  );
  const prisma = new Error(
    'Invalid `prisma.resident.create()` invocation:\n{ data: { firstName: "Asha", phone: "9000000001" } }',
  );
  prisma.name = 'PrismaClientKnownRequestError';
  (prisma as any).code = 'P2002';
  reporter.capture(prisma, { requestId: UUID, status: 500 });
  await reporter.flush!(2000);
  assert.equal(events().length, 2);
  const text = JSON.stringify(envelopes);
  for (const secret of [
    'topsecretpw',
    'asha@',
    '9000000001',
    'abc.def.ghi',
    'hunter2',
    'AbCdEf',
    'Asha',
    'db.internal',
  ]) {
    assert.ok(!text.includes(secret), `${secret} reached Sentry`);
  }
  assert.ok(text.includes('PrismaClientKnownRequestError'));
});

test('a property attached to the error object (a request, a payload) is not sent', async () => {
  const { reporter, envelopes } = start();
  const error: any = new Error('with baggage');
  error.request = { headers: { cookie: 'nook_session=secretsessionvalue' } };
  error.payload = { password: 'hunter2hunter2', amount: '5000.00' };
  error.cause = new Error('inner postgresql://u:innerpw@h/db');
  reporter.capture(error, { requestId: UUID, status: 500 });
  await reporter.flush!(2000);
  const text = JSON.stringify(envelopes);
  for (const secret of ['secretsessionvalue', 'hunter2', '5000.00', 'innerpw']) {
    assert.ok(!text.includes(secret), `${secret} reached Sentry`);
  }
});

test('beforeSend is a second line of defence: it strips request data, breadcrumbs and unknown contexts', () => {
  const dirty: any = {
    request: {
      url: 'https://x/api/v1/residents?search=Asha',
      cookies: { nook_session: 's' },
      headers: { cookie: 's' },
    },
    server_name: 'laptop.local',
    modules: { a: '1' },
    breadcrumbs: [{ message: 'GET /x?q=Asha' }],
    user: { id: ORG, email: 'a@b.in', ip_address: '1.2.3.4', username: 'asha' },
    message: 'failed for asha@example.in',
    exception: { values: [{ type: 'Error', value: 'password=hunter2hunter2 for 9000000001' }] },
    extra: { password: 'p', note: 'a@b.in' },
    contexts: {
      device: { name: 'laptop' },
      os: { name: 'macOS' },
      runtime: { name: 'node' },
      trace: { trace_id: 'x' },
    },
  };
  const clean: any = scrubEvent(dirty);
  const text = JSON.stringify(clean);
  for (const leak of [
    'Asha',
    'cookie',
    'laptop',
    'a@b.in',
    '1.2.3.4',
    'asha',
    'hunter2',
    '9000000001',
    'macOS',
  ]) {
    assert.ok(!text.toLowerCase().includes(leak.toLowerCase()), `${leak} survived`);
  }
  assert.deepEqual(clean.user, { id: ORG });
  assert.deepEqual(clean.breadcrumbs, []);
  assert.ok(clean.contexts.runtime && clean.contexts.trace);
  assert.deepEqual(scrubEvent({} as any).user, {});
});

test('helpers: route names group by route, sanitized errors keep only frames', () => {
  assert.equal(
    routeName('GET', `/api/v1/residents/${UUID}?search=Asha`),
    'GET /api/v1/residents/:id',
  );
  assert.equal(routeName(undefined, undefined), 'UNKNOWN unknown');
  const safe = sanitizedError(new Error('x password=hunter2hunter2'));
  assert.ok(!safe.message.includes('hunter2'));
  assert.ok(
    safe
      .stack!.split('\n')
      .slice(1)
      .every((line) => line.trim().startsWith('at ')),
  );
  assert.equal(sanitizedError('just a string').name, 'NonError');
});

test('a failing transport never breaks the caller', async () => {
  const reporter = initSentryReporter({
    dsn: DSN,
    environment: 'production',
    transport: (() => ({
      send: async () => {
        throw new Error('network down');
      },
      flush: async () => true,
    })) as any,
  });
  current = reporter;
  assert.doesNotThrow(() => reporter.capture(new Error('x'), { status: 500 }));
  await assert.doesNotReject(reporter.flush!(500));
});

test('SENTRY_DSN and SENTRY_ENVIRONMENT are validated, optional, and never echoed in an error', () => {
  assert.equal(parseSentryDsn(undefined), undefined);
  assert.equal(parseSentryDsn(' '), undefined);
  assert.equal(parseSentryDsn(DSN), DSN);
  for (const bad of [
    'not a url',
    'http://key@host/1',
    'https://host/1',
    'https://key@host/',
    'https://key@host/abc',
    'ftp://k@h/1',
  ]) {
    assert.throws(
      () => parseSentryDsn(bad),
      (e: Error) => /SENTRY_DSN must be/.test(e.message) && !e.message.includes(bad),
    );
  }
  assert.equal(parseSentryEnvironment(undefined, 'production'), 'production');
  assert.equal(parseSentryEnvironment('staging', 'production'), 'staging');
  assert.throws(() => parseSentryEnvironment('has space', 'production'), /SENTRY_ENVIRONMENT/);
  const config = loadRuntimeConfig({
    APP_ENV: 'production',
    WEB_ORIGIN: 'https://app.example.com',
    TRUST_PROXY_HOPS: '1',
    SENTRY_DSN: DSN,
  });
  assert.equal(config.sentryDsn, DSN);
  assert.equal(config.sentryEnvironment, 'production');
  const off = loadRuntimeConfig({ APP_ENV: 'test', WEB_ORIGIN: 'http://localhost:5173' });
  assert.equal(off.sentryDsn, undefined);
});
