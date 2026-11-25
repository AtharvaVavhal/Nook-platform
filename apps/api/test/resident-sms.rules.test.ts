import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseResidentConfig } from '../src/config.js';
import { otpMessageBody } from '../src/resident-auth/otp.js';
import { normalizeIndianMobile } from '../src/resident-auth/phone.js';
import { MockSmsProvider } from '../src/resident-auth/sms/mock-sms.provider.js';
import { createSmsProvider } from '../src/resident-auth/sms/sms.factory.js';
import {
  DisabledSmsProvider,
  SmsDeliveryError,
  SmsDispatcher,
  type SmsMessage,
  type SmsProvider,
} from '../src/resident-auth/sms/sms.js';

// Database-free tests of the SMS layer. No real provider exists: MSG91's request details could not be confirmed from its official
// documentation (see PHASE_2 reports), so only the provider-neutral contract, the disabled default and the mock are covered here.

const FAST = { timeoutMs: 40, maxAttempts: 2, retryDelayMs: 1 };
const PHONE = '+919876543210';
const CODE = '482913';
const message: SmsMessage = { to: PHONE, body: otpMessageBody(CODE, 5), reference: 'challenge-1' };

test('successful mock delivery records the message and reports only provider and attempts', async () => {
  const provider = new MockSmsProvider();
  const result = await new SmsDispatcher(provider, FAST).send(message);
  assert.deepEqual(result, { status: 'SENT', attempts: 1, provider: 'mock' });
  assert.equal(provider.outbox.length, 1);
  assert.equal(provider.lastCodeFor(PHONE), CODE);
});

test('provider rejection is permanent: one attempt, structured failure, no retry', async () => {
  const provider = new MockSmsProvider();
  provider.failNext('permanent', 'PROVIDER_REJECTED');
  const result = await new SmsDispatcher(provider, FAST).send(message);
  assert.deepEqual(result, {
    status: 'FAILED',
    attempts: 1,
    provider: 'mock',
    failure: { kind: 'permanent', code: 'PROVIDER_REJECTED' },
  });
  assert.equal(provider.outbox.length, 0);
});

test('timeout is cut off by the dispatcher and reported as a timeout', async () => {
  const provider = new MockSmsProvider();
  provider.delayMs = 500;
  const started = Date.now();
  const result = await new SmsDispatcher(provider, { ...FAST, maxAttempts: 1 }).send(message);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failure?.kind, 'timeout');
  assert.ok(Date.now() - started < 300);
});

test('a network failure (unknown error) is transient and its text is never surfaced', async () => {
  const leaky: SmsProvider = {
    name: 'leaky',
    send: () => Promise.reject(new Error(`ECONNRESET to ${PHONE} while sending code ${CODE}`)),
  };
  const result = await new SmsDispatcher(leaky, FAST).send(message);
  assert.deepEqual(result.failure, { kind: 'transient', code: 'PROVIDER_ERROR' });
  assert.equal(result.attempts, 2);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${CODE}|9876543210|ECONNRESET`));
});

test('missing configuration: the default provider is disabled, fails permanently and delivers nothing', async () => {
  assert.ok(createSmsProvider({ appEnv: 'production' }) instanceof DisabledSmsProvider);
  const result = await new SmsDispatcher(new DisabledSmsProvider(), FAST).send(message);
  assert.deepEqual(result, {
    status: 'FAILED',
    attempts: 1,
    provider: 'disabled',
    failure: { kind: 'permanent', code: 'PROVIDER_NOT_CONFIGURED' },
  });
});

test('live SMS cannot be switched on by configuration: only disabled and mock parse, mock is refused in production, msg91 is unknown', () => {
  const origin = 'https://resident.example.invalid';
  const base = { RESIDENT_WEB_ORIGIN: origin, RESIDENT_OTP_SECRET: 'x'.repeat(40) };
  assert.equal(
    parseResidentConfig({ ...base }, 'production', 'https://app.example.invalid')
      .residentSmsProvider,
    'disabled',
  );
  assert.throws(
    () =>
      parseResidentConfig(
        { ...base, RESIDENT_SMS_PROVIDER: 'mock' },
        'production',
        'https://app.example.invalid',
      ),
    /mock/,
  );
  assert.throws(
    () =>
      parseResidentConfig(
        { ...base, RESIDENT_SMS_PROVIDER: 'msg91' },
        'production',
        'https://app.example.invalid',
      ),
    /must be one of/,
  );
});

test('invalid destinations never reach a provider: malformed numbers normalise to null', () => {
  for (const bad of [
    undefined,
    null,
    12345,
    '',
    'abc',
    '12345',
    '+1 202 555 0100',
    '5876543210',
    '9'.repeat(30),
    '+919876543',
  ]) {
    assert.equal(normalizeIndianMobile(bad), null, String(bad));
  }
  assert.equal(normalizeIndianMobile('098765 43210'), PHONE);
  assert.equal(normalizeIndianMobile('+91-98765-43210'), PHONE);
});

test('invalid message input: the message text carries the code once and the provider contract takes E.164 only', () => {
  assert.equal(message.body.split(CODE).length - 1, 1);
  assert.match(message.body, /expires in 5 minutes/);
  assert.match(message.to, /^\+91[6-9]\d{9}$/);
});

test('no credential or code leakage: dispatching never calls console and the module has no logging at all', async () => {
  const calls: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods)
    console[m] = ((...args: unknown[]) => void calls.push(args.join(' '))) as never;
  try {
    const failing = new MockSmsProvider();
    failing.failNext('transient', 'PROVIDER_UNAVAILABLE', 3);
    await new SmsDispatcher(new MockSmsProvider(), FAST).send(message);
    await new SmsDispatcher(failing, FAST).send(message);
    await new SmsDispatcher(new DisabledSmsProvider(), FAST).send(message);
  } finally {
    methods.forEach((m, i) => (console[m] = saved[i] as never));
  }
  assert.deepEqual(
    calls,
    [],
    'the dispatcher logs nothing; the caller logs ids and failure codes only',
  );
  const source = readFileSync(new URL('../src/resident-auth/sms/sms.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.|json-logger|\blog\./);
});

test('no fallback provider: exactly the configured provider is called, once per attempt, and nothing else', async () => {
  let primary = 0;
  let secondary = 0;
  const first: SmsProvider = {
    name: 'primary',
    send: () => {
      primary += 1;
      return Promise.reject(new SmsDeliveryError('transient', 'PROVIDER_UNAVAILABLE'));
    },
  };
  const second: SmsProvider = {
    name: 'secondary',
    send: () => {
      secondary += 1;
      return Promise.resolve({});
    },
  };
  void second;
  const result = await new SmsDispatcher(first, FAST).send(message);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.provider, 'primary');
  assert.equal(primary, 2);
  assert.equal(secondary, 0);
});

test('KNOWN LIMITATION (finding): a timeout that hid a successful send is retried, so the same code can be delivered twice', async () => {
  let calls = 0;
  const slowThenFast: SmsProvider = {
    name: 'slow-then-fast',
    send: (_m, { signal }) => {
      calls += 1;
      if (calls === 1)
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      return Promise.resolve({});
    },
  };
  const result = await new SmsDispatcher(slowThenFast, FAST).send(message);
  assert.equal(result.status, 'SENT');
  assert.equal(
    calls,
    2,
    'two sends were attempted for one code; with a real provider the first may have been delivered',
  );
});
