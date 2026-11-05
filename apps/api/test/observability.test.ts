/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles and parsed log lines are untyped */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { parseLogLevel } from '../src/config.js';
import { AllExceptionsFilter } from '../src/observability/all-exceptions.filter.js';
import { setErrorReporter, type ErrorReportContext } from '../src/observability/error-reporter.js';
import { JsonLogger, log } from '../src/observability/json-logger.js';
import { REDACTED, redact, scrubString, serializeError } from '../src/observability/redact.js';
import {
  auditRequestId,
  currentRequestId,
  runWithRequest,
} from '../src/observability/request-context.js';
import { chooseRequestId, requestIdMiddleware } from '../src/observability/request-id.js';

const UUID = '3f2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e6f';

// ------------------------------------------------------------------------------- redaction by key

test('redact: sensitive keys lose their value, wherever they are nested', () => {
  const out = redact({
    password: 'hunter2hunter2',
    newPassword: 'x',
    currentPassword: 'y',
    token: 't',
    csrfToken: 'c',
    'x-csrf-token': 'c',
    cookie: 'nook_session=abc',
    Cookie: 'nook_session=abc',
    authorization: 'Bearer abc',
    passphrase: 'p',
    apiKey: 'k',
    tokenHash: 'h',
    nested: { deeper: { secret: 's', list: [{ password: 'p' }] } },
  }) as Record<string, any>;
  for (const key of [
    'password',
    'newPassword',
    'currentPassword',
    'token',
    'csrfToken',
    'x-csrf-token',
    'cookie',
    'Cookie',
    'authorization',
    'passphrase',
    'apiKey',
    'tokenHash',
  ]) {
    assert.equal(out[key], REDACTED, key);
  }
  assert.equal(out.nested.deeper.secret, REDACTED);
  assert.equal(out.nested.deeper.list[0].password, REDACTED);
});

test('redact: financial amounts and personal data are redacted by key', () => {
  const out = redact({
    amount: '5000.00',
    paidAmount: '100',
    monthlyPrice: 4200,
    adjustmentTotal: '-10',
    balance: '0',
    accountNumber: '1234',
    upiId: 'a@upi',
    ifsc: 'HDFC0001',
    phone: '9000000001',
    email: 'a@b.in',
    firstName: 'Asha',
    lastName: 'Rao',
    address: 'Baner',
    dateOfBirth: '2000-01-01',
    documentUrl: 'https://x',
    notes: 'private note',
    emergencyContactPhone: '9',
    reason: 'because',
  }) as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) assert.equal(value, REDACTED, key);
});

test('redact: the fields the logger itself relies on are never redacted', () => {
  const fields = {
    requestId: UUID,
    status: 500,
    statusCode: 404,
    method: 'POST',
    path: '/api/v1/residents',
    route: '/api/v1/residents/:id',
    durationMs: 12.3,
    userId: UUID,
    organizationId: UUID,
    role: 'OWNER',
    errorCode: 'P2002',
    queryKeys: ['search', 'page'],
    context: 'http',
  };
  assert.deepEqual(redact(fields), fields);
});

test('redact: values that are not plain data are handled safely', () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assert.deepEqual(redact(cyclic), { a: 1, self: '[circular]' });
  assert.equal(redact(BigInt(5)), '5');
  assert.equal(redact(new Date('2026-11-03T00:00:00Z')), '2026-11-03T00:00:00.000Z');
  assert.equal(redact(new Date('nope')), null);
  assert.equal(
    redact(() => 1),
    undefined,
  );
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
  let deep: any = { v: 'end' };
  for (let i = 0; i < 12; i += 1) deep = { child: deep };
  assert.match(JSON.stringify(redact(deep)), /\[truncated\]/);
  const list = redact(Array.from({ length: 200 }, (_, i) => i)) as unknown[];
  assert.equal(list.length, 51);
  assert.equal(list.at(-1), '[+150 more]');
  assert.ok(String(redact('x'.repeat(5000))).length <= 501);
  // a decimal-like value object renders as nothing useful
  const decimalLike = { d: [1], toFixed: () => '1.00' };
  assert.equal(redact({ foo: decimalLike }) && (redact({ foo: decimalLike }) as any).foo, REDACTED);
});

// ------------------------------------------------------------------------------- redaction by value

test('scrubString: connection strings, bearer tokens, JWTs, cookies and key=value secrets', () => {
  const dbUrl =
    'postgresql://nook_runtime:s3cr3tPassw0rd@db.example.internal:5432/nook?sslmode=require';
  assert.equal(scrubString(`connect ECONNREFUSED ${dbUrl}`).includes('s3cr3tPassw0rd'), false);
  assert.match(scrubString(dbUrl), /^postgresql:\/\/\[REDACTED\]\/nook\?sslmode=require$/);
  assert.ok(!scrubString(dbUrl).includes('db.example.internal'));
  assert.ok(!scrubString('Authorization: Bearer abc.def.ghi-123').includes('abc.def.ghi'));
  assert.equal(scrubString('x Bearer abc.def.ghi-123 y'), `x Bearer ${REDACTED} y`);
  assert.ok(
    !scrubString(
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    ).includes('SflKxw'),
  );
  const cookies = scrubString('Cookie: nook_session=AbCdEf123; nook_csrf=ZyX987');
  assert.ok(!cookies.includes('AbCdEf123') && !cookies.includes('ZyX987'), cookies);
  assert.ok(!scrubString('login failed password=hunter2hunter2 for user').includes('hunter2'));
  assert.ok(!scrubString('{"password":"hunter2hunter2","x":1}').includes('hunter2'));
  assert.ok(!scrubString("token: 'abcdef123456'").includes('abcdef123456'));
});

test('scrubString: e-mail addresses and phone or account numbers go, dates, times and ids stay', () => {
  assert.equal(scrubString('no user asha.rao+x@example.co.in found'), 'no user [email] found');
  assert.equal(scrubString('duplicate phone 9000000001'), 'duplicate phone [number]');
  assert.equal(scrubString('duplicate phone +91 98765 43210'), 'duplicate phone [number]');
  assert.equal(scrubString('card 4111 1111 1111 1111 declined'), 'card [number] declined');
  const kept =
    'on 2026-11-03 at 12:30:00, booking ' + UUID + ' (invoice INV-2026-0001) took 1200 ms';
  assert.equal(scrubString(kept), kept);
  // an id that happens to be all digits is still an id
  const digitsOnly = '12345678-1234-1234-1234-123456789012';
  assert.equal(scrubString(`id ${digitsOnly}`), `id ${digitsOnly}`);
});

test('redact: string values inside fields are scrubbed too', () => {
  const out = redact({ detail: 'failed for asha@example.in with password=abc12345' }) as Record<
    string,
    string
  >;
  const detail = out.detail ?? '';
  assert.ok(detail.length > 0 && !detail.includes('asha@') && !detail.includes('abc12345'));
});

// ------------------------------------------------------------------------------- errors

test('serializeError: a database-client error keeps no query values; stacks keep only their frames', () => {
  const error = new Error(
    'Invalid `prisma.resident.create()` invocation:\n\n{ data: { firstName: "Asha", phone: "9000000001" } }\nUnique constraint failed',
  );
  error.name = 'PrismaClientKnownRequestError';
  (error as any).code = 'P2002';
  const out = serializeError(error);
  assert.equal(out.code, 'P2002');
  assert.ok(!JSON.stringify(out).includes('Asha') && !JSON.stringify(out).includes('9000000001'));
  assert.ok(out.message.startsWith('Invalid `prisma.resident.create()`'));
  assert.ok(out.stack && out.stack.length > 0 && out.stack.every((line) => line.startsWith('at ')));
});

test('serializeError: ordinary errors are scrubbed, and non-errors do not throw', () => {
  const out = serializeError(
    new Error('cannot reach postgresql://u:topsecretpw@host/db for a@b.in'),
  );
  assert.ok(!out.message.includes('topsecretpw') && !out.message.includes('a@b.in'));
  assert.equal(serializeError('plain string').name, 'NonError');
  assert.equal(serializeError({ any: 'object' }).message, 'object thrown');
  assert.equal(serializeError(undefined).name, 'NonError');
});

// ------------------------------------------------------------------------------- logger

function capture(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
  const lines: string[] = [];
  const logger = new JsonLogger();
  logger.configure({ level, sink: (l) => lines.push(l), base: { env: 'test' } });
  return { logger, lines, parsed: () => lines.map((l) => JSON.parse(l) as Record<string, any>) };
}

test('logger: one JSON object per line, with level, message, timestamp and service (what Railway reads)', () => {
  const { logger, lines, parsed } = capture();
  logger.info('hello\nworld', { port: 3000, context: 'bootstrap' });
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes('\n'), 'a newline in the message cannot split the line');
  const [entry] = parsed();
  assert.equal(entry!.level, 'info');
  assert.equal(entry!.message, 'hello\nworld');
  assert.equal(entry!.service, 'nook-api');
  assert.equal(entry!.env, 'test');
  assert.equal(entry!.port, 3000);
  assert.equal(entry!.context, 'bootstrap');
  assert.ok(!Number.isNaN(Date.parse(entry!.timestamp)));
});

test("logger: levels filter, and Nest's own calls map onto them", () => {
  const warn = capture('warn');
  warn.logger.debug('d');
  warn.logger.info('i');
  warn.logger.log('nest log');
  warn.logger.verbose('nest verbose');
  warn.logger.warn('w');
  warn.logger.error('e');
  warn.logger.fatal('f');
  assert.deepEqual(
    warn.parsed().map((e) => e.level),
    ['warn', 'error', 'error'],
  );
  const debug = capture('debug');
  debug.logger.log('startup', 'NestFactory');
  debug.logger.error('boom', 'Error: boom\n    at x (file.js:1:1)\n    at y (file.js:2:2)', 'Ctx');
  const [a, b] = debug.parsed();
  assert.equal(a!.context, 'NestFactory');
  assert.equal(b!.level, 'error');
  assert.equal(b!.context, 'Ctx');
  assert.ok(Array.isArray(b!.stack));
  assert.equal(isEnabled(debug.logger), true);
});
function isEnabled(l: JsonLogger) {
  return l.isEnabled('debug');
}

test('logger: every field and the message are redacted before they are written', () => {
  const { logger, lines } = capture();
  logger.error('db down postgresql://u:pw123456@h/db', {
    password: 'hunter2hunter2',
    cookie: 'nook_session=abc',
    amount: '5000.00',
    phone: '9000000001',
    detail: 'user a@b.in',
    err: new Error('x password=hunter2hunter2'),
  });
  const text = lines.join('');
  for (const secret of [
    'pw123456',
    'hunter2',
    'nook_session=abc',
    '5000.00',
    '9000000001',
    'a@b.in',
  ]) {
    assert.ok(!text.includes(secret), `${secret} leaked: ${text}`);
  }
});

test('logger: the current request id is added automatically', () => {
  const { logger, parsed } = capture();
  logger.info('outside');
  runWithRequest({ requestId: UUID }, () => logger.info('inside'));
  const [outside, inside] = parsed();
  assert.equal(outside!.requestId, undefined);
  assert.equal(inside!.requestId, UUID);
});

test('logger: a failing sink or an unserialisable value never throws', () => {
  const logger = new JsonLogger();
  logger.configure({
    level: 'info',
    sink: () => {
      throw new Error('disk full');
    },
  });
  assert.doesNotThrow(() => logger.error('still fine'));
  const { logger: ok, lines } = capture();
  const cyclic: any = {};
  cyclic.self = cyclic;
  assert.doesNotThrow(() => ok.info('cyclic', cyclic));
  assert.equal(lines.length, 1);
});

// ------------------------------------------------------------------------------- request id

test('request id: a UUID from the caller is kept, anything else is replaced', () => {
  assert.equal(chooseRequestId(UUID), UUID);
  assert.equal(chooseRequestId(UUID.toUpperCase()), UUID);
  assert.equal(chooseRequestId([UUID, 'x']), UUID);
  for (const bad of [
    undefined,
    '',
    'abc',
    'x'.repeat(200),
    `${UUID}\nfake log line`,
    `${UUID} `,
    '<script>',
    42,
    null,
    {},
  ]) {
    const id = chooseRequestId(bad);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.notEqual(id, bad);
  }
  assert.notEqual(chooseRequestId(undefined), chooseRequestId(undefined));
});

test('request id middleware: sets the response header and the context for the rest of the request', async () => {
  const headers: Record<string, string> = {};
  const res: any = { setHeader: (k: string, v: string) => (headers[k] = v) };
  const req: any = { headers: { 'x-request-id': UUID } };
  let seen: string | undefined;
  await new Promise<void>((resolve) =>
    requestIdMiddleware(req, res, () => {
      seen = currentRequestId();
      assert.equal(auditRequestId(), UUID);
      resolve();
    }),
  );
  assert.equal(headers['X-Request-Id'], UUID);
  assert.equal(seen, UUID);
  assert.equal(req.requestId, UUID);
  assert.equal(currentRequestId(), undefined, 'the context does not leak outside the request');
  assert.match(
    auditRequestId(),
    /^[0-9a-f-]{36}$/,
    'outside a request an audit id is still generated',
  );
});

// ------------------------------------------------------------------------------- exception filter

function fakeHost(over: Record<string, unknown> = {}) {
  const sent: { status?: number; body?: any; ended?: boolean } = {};
  const res: any = {
    headersSent: false,
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
    end() {
      sent.ended = true;
    },
    ...over,
  };
  const req: any = {
    method: 'POST',
    originalUrl: '/api/v1/residents?search=Asha%20Rao',
    auth: { userId: UUID, organizationId: UUID },
  };
  const host: any = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) };
  return { host, sent, res };
}

test('filter: an HttpException keeps its deliberate body and status exactly', () => {
  const filter = new AllExceptionsFilter();
  for (const [exception, status, body] of [
    [
      new NotFoundException('Resident not found'),
      404,
      { message: 'Resident not found', error: 'Not Found', statusCode: 404 },
    ],
    [
      new BadRequestException('startDate must be a valid date'),
      400,
      { message: 'startDate must be a valid date', error: 'Bad Request', statusCode: 400 },
    ],
    [new HttpException({ code: 'UNAUTHENTICATED' }, 401), 401, { code: 'UNAUTHENTICATED' }],
    [new HttpException('plain text', 409), 409, { statusCode: 409, message: 'plain text' }],
  ] as const) {
    const { host, sent } = fakeHost();
    filter.catch(exception, host);
    assert.equal(sent.status, status);
    assert.deepEqual(sent.body, body);
  }
});

test('filter: an unexpected error becomes a safe 500 with only the request id; the detail goes to the log and reporter', () => {
  const lines: string[] = [];
  const reported: Array<{ error: unknown; context: ErrorReportContext }> = [];
  setErrorReporter({ capture: (error, context) => reported.push({ error, context }) });
  log.configure({ level: 'info', sink: (l) => lines.push(l) });
  try {
    const filter = new AllExceptionsFilter();
    const error = new Error(
      'connect failed postgresql://nook:topsecretpw@db.internal/nook for asha@example.in',
    );
    runWithRequest({ requestId: UUID }, () => {
      const { host, sent } = fakeHost();
      filter.catch(error, host);
      assert.equal(sent.status, 500);
      assert.deepEqual(sent.body, {
        statusCode: 500,
        message: 'Internal server error',
        requestId: UUID,
      });
      const clientText = JSON.stringify(sent.body);
      for (const leak of ['topsecretpw', 'asha@', 'postgresql', 'Error:', 'at ', 'stack']) {
        assert.ok(!clientText.includes(leak), `client body leaked ${leak}`);
      }
    });
    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.message, 'unhandled exception');
    assert.equal(entry.level, 'error');
    assert.equal(entry.requestId, UUID);
    assert.equal(
      entry.path,
      '/api/v1/residents',
      'the query string (which can hold a name) is not logged',
    );
    assert.equal(entry.userId, UUID);
    assert.ok(
      Array.isArray(entry.err.stack) && entry.err.stack.length > 0,
      'the stack frames are in the log',
    );
    assert.ok(!lines.join('').includes('topsecretpw') && !lines.join('').includes('asha@'));
    assert.equal(reported.length, 1);
    assert.equal(reported[0]!.error, error);
    assert.deepEqual(
      {
        requestId: reported[0]!.context.requestId,
        status: reported[0]!.context.status,
        path: reported[0]!.context.path,
      },
      { requestId: UUID, status: 500, path: '/api/v1/residents' },
    );
  } finally {
    setErrorReporter({ capture: () => {} });
    log.configure({ sink: () => {} });
  }
});

test('filter: a 5xx HttpException is also hidden, a throwing reporter changes nothing, headers already sent just end', () => {
  setErrorReporter({
    capture: () => {
      throw new Error('reporter down');
    },
  });
  const filter = new AllExceptionsFilter();
  const { host, sent } = fakeHost();
  filter.catch(new HttpException('internal detail: SELECT * FROM residents', 502), host);
  assert.equal(sent.status, 502);
  assert.ok(!JSON.stringify(sent.body).includes('SELECT'));
  const unavailable = fakeHost();
  runWithRequest({ requestId: UUID }, () =>
    filter.catch(
      new HttpException({ status: 'degraded', dependency: 'database' }, 503),
      unavailable.host,
    ),
  );
  assert.equal(unavailable.sent.status, 503);
  assert.deepEqual(unavailable.sent.body, {
    status: 'degraded',
    dependency: 'database',
    requestId: UUID,
  });
  const textual = fakeHost();
  filter.catch(new HttpException('database password is hunter2', 503), textual.host);
  assert.equal(textual.sent.body.message, 'Service unavailable');
  assert.ok(!JSON.stringify(textual.sent.body).includes('hunter2'));
  const already = fakeHost({ headersSent: true });
  filter.catch(new Error('late'), already.host);
  assert.equal(already.sent.ended, true);
  assert.equal(already.sent.body, undefined);
  setErrorReporter({ capture: () => {} });
});

// ------------------------------------------------------------------------------- config

test('LOG_LEVEL: validated, with a quieter default under test', () => {
  assert.equal(parseLogLevel(undefined, 'production'), 'info');
  assert.equal(parseLogLevel('', 'development'), 'info');
  assert.equal(parseLogLevel(undefined, 'test'), 'warn');
  assert.equal(parseLogLevel(' DEBUG ', 'production'), 'debug');
  assert.throws(() => parseLogLevel('verbose', 'production'), /LOG_LEVEL must be one of/);
  assert.throws(() => parseLogLevel('trace', 'test'), /LOG_LEVEL/);
});
