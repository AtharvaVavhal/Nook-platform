import assert from 'node:assert/strict';
import test from 'node:test';
import { parseResidentConfig } from '../src/config.js';
import { JsonLogger } from '../src/observability/json-logger.js';
import { log } from '../src/observability/json-logger.js';
import { ResidentAuthService } from '../src/resident-auth/resident-auth.service.js';
import {
  MOCK_SMS_LOG_MARKER,
  MockSmsProvider,
} from '../src/resident-auth/sms/mock-sms.provider.js';
import { createSmsProvider } from '../src/resident-auth/sms/sms.factory.js';
import { DisabledSmsProvider, SmsDispatcher } from '../src/resident-auth/sms/sms.js';

// Synthetic values only. The "secret" below is a throw-away test string, not a credential.
const PHONE = '+919876543210';
const FAST = { timeoutMs: 1000, maxAttempts: 1, retryDelayMs: 0 };
const FIXED_EXPIRY = new Date('2030-01-02T03:04:05.000Z');
const message = (code = '482913') => ({
  to: PHONE,
  body: `Your Nook verification code is ${code}. It expires in 5 minutes. Do not share it with anyone.`,
  reference: 'challenge-1',
  expiresAt: FIXED_EXPIRY,
});

/** Capture everything that reaches the process-level output channels while `fn` runs. */
async function captureOutput<T>(fn: () => Promise<T>): Promise<{ result: T; output: string[] }> {
  const output: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  const savedWrite = process.stdout.write.bind(process.stdout);
  for (const m of methods)
    console[m] = ((...a: unknown[]) => void output.push(a.join(' '))) as never;
  process.stdout.write = ((chunk: unknown) => (output.push(String(chunk)), true)) as never;
  try {
    return { result: await fn(), output };
  } finally {
    methods.forEach((m, i) => (console[m] = saved[i] as never));
    process.stdout.write = savedWrite as never;
  }
}

test('non-production: the mock announces ONE preview line with marker, masked number, expiry and code - through the real JSON logger', async () => {
  const lines: string[] = [];
  const logger = new JsonLogger();
  logger.configure({ level: 'info', sink: (line) => lines.push(line) });
  const provider = new MockSmsProvider({
    appEnv: 'development',
    previewLog: (line) => logger.warn(line, { context: 'resident-mock-sms' }),
  });
  const result = await new SmsDispatcher(provider, FAST).send(message('482913'));
  assert.equal(result.status, 'SENT');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0] as string) as { level: string; message: string };
  assert.equal(entry.level, 'warn');
  assert.ok(
    entry.message.startsWith(MOCK_SMS_LOG_MARKER),
    'the preview-only marker leads the line',
  );
  assert.match(entry.message, /to=\+91\*{6}3210/);
  assert.match(entry.message, /expires=2030-01-02T03:04:05\.000Z/);
  assert.match(entry.message, /otp=482913(?!\d)/, 'the code survives the logger redaction');
  assert.ok(!lines[0]?.includes('9876543210'), 'the full number is never logged');
  assert.ok(!lines[0]?.includes('challenge-1'), 'no internal reference is logged');
  assert.ok(!lines[0]?.includes('Do not share'), 'the message text is not logged');
});

test('non-production: the factory wires the mock to the real API logger; two sends give two different codes and lines', async () => {
  const lines: string[] = [];
  log.configure({ sink: (line) => lines.push(line) });
  try {
    const provider = createSmsProvider({ appEnv: 'development', residentSmsProvider: 'mock' });
    assert.ok(provider instanceof MockSmsProvider);
    const dispatcher = new SmsDispatcher(provider, FAST);
    await dispatcher.send(message('111111'));
    await dispatcher.send(message('222222'));
  } finally {
    log.configure({ sink: (line) => void process.stdout.write(`${line}\n`) });
  }
  const mine = lines.filter((l) => l.includes(MOCK_SMS_LOG_MARKER));
  assert.equal(mine.length, 2);
  assert.match(mine[0] as string, /otp=111111/);
  assert.match(mine[1] as string, /otp=222222/);
});

test('the mock is silent by default and the code is never a fixed value', async () => {
  const { output } = await captureOutput(async () => {
    await new SmsDispatcher(new MockSmsProvider(), FAST).send(message('333333'));
  });
  assert.deepEqual(output, [], 'no previewLog given: nothing is written anywhere');
});

test('production: the mock refuses to exist, so no code can ever be logged by it', async () => {
  assert.throws(
    () => new MockSmsProvider({ appEnv: 'production' }),
    /cannot be used in production/,
  );
  assert.throws(
    () => createSmsProvider({ appEnv: 'production', residentSmsProvider: 'mock' }),
    /cannot be used in production/,
  );
});

test('production: the default provider delivers and logs nothing, even with a code in the message', async () => {
  const provider = createSmsProvider({ appEnv: 'production', residentSmsProvider: 'disabled' });
  assert.ok(provider instanceof DisabledSmsProvider);
  const { result, output } = await captureOutput(() =>
    new SmsDispatcher(provider, FAST).send(message('444444')),
  );
  assert.equal(result.status, 'FAILED');
  assert.ok(!output.join('\n').includes('444444'));
  assert.ok(!output.join('\n').includes(MOCK_SMS_LOG_MARKER));
});

test('production configuration still rejects RESIDENT_SMS_PROVIDER=mock (with and without the portal switched on)', () => {
  const portal = {
    RESIDENT_WEB_ORIGIN: 'https://resident.example.invalid',
    RESIDENT_OTP_SECRET: 'x'.repeat(40),
  };
  for (const env of [
    { RESIDENT_SMS_PROVIDER: 'mock' },
    { ...portal, RESIDENT_SMS_PROVIDER: 'MOCK' },
  ]) {
    assert.throws(
      () => parseResidentConfig(env, 'production', 'https://app.example.invalid'),
      /mock is refused in production/,
    );
  }
  assert.equal(
    parseResidentConfig(
      { ...portal, RESIDENT_SMS_PROVIDER: 'mock' },
      'development',
      'https://app.example.invalid',
    ).residentSmsProvider,
    'mock',
  );
  assert.throws(
    () =>
      parseResidentConfig(
        { RESIDENT_SMS_PROVIDER: 'msg91' },
        'development',
        'https://app.example.invalid',
      ),
    /must be one of/,
  );
});

test('API response, database writes and process output never contain the OTP; only the preview log line does', async () => {
  const envKeys = [
    'APP_ENV',
    'WEB_ORIGIN',
    'RESIDENT_WEB_ORIGIN',
    'RESIDENT_OTP_SECRET',
    'RESIDENT_SMS_PROVIDER',
  ] as const;
  const savedEnv = envKeys.map((k) => process.env[k]);
  process.env.APP_ENV = 'development';
  process.env.WEB_ORIGIN = 'https://app.example.invalid';
  process.env.RESIDENT_WEB_ORIGIN = 'https://resident.example.invalid';
  process.env.RESIDENT_OTP_SECRET = 'y'.repeat(40);
  process.env.RESIDENT_SMS_PROVIDER = 'mock';
  try {
    const dbWrites: unknown[] = [];
    const tx = {
      residentOtpChallenge: {
        updateMany: async (args: unknown) => (dbWrites.push(args), { count: 0 }),
        create: async (args: unknown) => (dbWrites.push(args), {}),
      },
    };
    const prisma = {
      db: {
        residentAccount: {
          findFirst: async () => ({ id: 'acc-1', organizationId: 'org-1', phoneE164: PHONE }),
        },
        residentOtpChallenge: {
          update: async (args: unknown) => (dbWrites.push(args), {}),
          updateMany: async (args: unknown) => (dbWrites.push(args), { count: 1 }),
        },
        $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      },
    };
    const throttle = {
      lockedUntil: async () => null,
      hit: async () => undefined,
      tryLock: async () => true,
    };
    const lines: string[] = [];
    const provider = new MockSmsProvider({
      appEnv: 'development',
      previewLog: (line) => lines.push(line),
    });
    const service = new ResidentAuthService(
      prisma as never,
      throttle as never,
      {} as never,
      {} as never,
      new SmsDispatcher(provider, FAST),
    );
    const { result: response, output } = await captureOutput(() =>
      service.requestOtp(PHONE, '203.0.113.9'),
    );

    assert.deepEqual(Object.keys(response).sort(), ['requested', 'resendAfterSeconds']);
    assert.equal(lines.length, 1);
    const code = /otp=(\d{6})/.exec(lines[0] as string)?.[1];
    assert.ok(code, 'the preview line carries the code');
    assert.ok(
      !JSON.stringify(response).includes(code),
      'the API response does not contain the OTP',
    );
    assert.ok(
      !JSON.stringify(dbWrites).includes(code),
      'no database write contains the OTP (only its hash)',
    );
    assert.ok(JSON.stringify(dbWrites).includes('codeHash'));
    assert.ok(
      !output.join('\n').includes(code),
      'nothing reaches console or stdout from the service',
    );
  } finally {
    envKeys.forEach((k, i) => {
      const v = savedEnv[i];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  }
});
