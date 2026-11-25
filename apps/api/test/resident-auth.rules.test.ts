import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Controller, Module, Post, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { configureApp, isOriginAllowed } from '../src/app.setup.js';
import { loadRuntimeConfig, parseResidentConfig, type RuntimeConfig } from '../src/config.js';
import {
  generateOtp,
  hashOtp,
  keyedHash,
  otpMatches,
  otpMessageBody,
} from '../src/resident-auth/otp.js';
import { maskPhone, normalizeIndianMobile } from '../src/resident-auth/phone.js';
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_MS,
  PORTAL_ELIGIBLE,
} from '../src/resident-auth/policy.js';
import { MockSmsProvider } from '../src/resident-auth/sms/mock-sms.provider.js';
import {
  DisabledSmsProvider,
  SmsDeliveryError,
  SmsDispatcher,
  type SmsProvider,
} from '../src/resident-auth/sms/sms.js';
import { createSmsProvider } from '../src/resident-auth/sms/sms.factory.js';

// Database-free tests of the resident sign-in building blocks. HTTP-level behaviour against PostgreSQL is in
// integration/resident-auth.integration.test.ts.

test('policy: the approved initial values', () => {
  assert.equal(OTP_LENGTH, 6);
  assert.equal(OTP_TTL_MS, 5 * 60 * 1000);
  assert.equal(OTP_MAX_ATTEMPTS, 5);
  assert.equal(OTP_RESEND_COOLDOWN_SECONDS, 30);
});

test('phone: every accepted spelling normalises to +91 and ten digits starting 6-9', () => {
  for (const ok of [
    '9876543210',
    '09876543210',
    '919876543210',
    '+919876543210',
    '00919876543210',
    '+91 98765 43210',
    '+91-98765-43210',
    '(98765) 43210',
    ' 9876543210 ',
    '6123456789',
  ])
    assert.equal(normalizeIndianMobile(ok), `+91${ok.replace(/\D/g, '').slice(-10)}`, ok);
});

test('phone: invalid input is refused (landline, short, long, foreign, letters, wrong type, injection)', () => {
  for (const bad of [
    '',
    '5876543210',
    '987654321',
    '98765432101',
    '+14155552671',
    '+9198765432',
    'abcdefghij',
    '9876543210; drop table',
    '+91 98765 4321O',
    '++919876543210',
    '0123456789',
    '+9109876543210',
  ])
    assert.equal(normalizeIndianMobile(bad), null, bad);
  for (const bad of [undefined, null, 9876543210, {}, [], ['9876543210'], true])
    assert.equal(normalizeIndianMobile(bad), null);
  assert.equal(normalizeIndianMobile('9'.repeat(30)), null);
});

test('phone: masking shows only the last four digits', () => {
  assert.equal(maskPhone('+919876543210'), '+91******3210');
  assert.ok(!maskPhone('+919876543210').includes('98765'));
});

test('otp: generated codes are six digits, keep leading zeros, and look random', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const code = generateOtp();
    assert.match(code, /^\d{6}$/);
    seen.add(code);
  }
  assert.ok(seen.size > 1900, `only ${seen.size} distinct codes in 2000`);
  assert.ok(
    [...seen].some((c) => c.startsWith('0')),
    'leading zeros occur',
  );
});

test('otp: the stored value is a keyed hash bound to challenge, account and code, never the code', () => {
  const secret = 'k'.repeat(40);
  const hash = hashOtp(secret, 'challenge-1', 'account-1', '123456');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes('123456'));
  assert.ok(otpMatches(hash, secret, 'challenge-1', 'account-1', '123456'));
  assert.equal(otpMatches(hash, secret, 'challenge-1', 'account-1', '123457'), false, 'wrong code');
  assert.equal(
    otpMatches(hash, secret, 'challenge-2', 'account-1', '123456'),
    false,
    'another challenge',
  );
  assert.equal(
    otpMatches(hash, secret, 'challenge-1', 'account-2', '123456'),
    false,
    'another account',
  );
  assert.equal(
    otpMatches(hash, 'z'.repeat(40), 'challenge-1', 'account-1', '123456'),
    false,
    'another key',
  );
  assert.equal(
    otpMatches('zz', secret, 'challenge-1', 'account-1', '123456'),
    false,
    'malformed stored value',
  );
  assert.notEqual(
    keyedHash(secret, 'OTP_REQUEST_PHONE', '+919876543210'),
    keyedHash(secret, 'OTP_VERIFY_PHONE', '+919876543210'),
  );
  assert.ok(otpMessageBody('123456', 5).includes('123456'));
});

test('config: resident settings are validated; nothing is enabled without RESIDENT_WEB_ORIGIN', () => {
  const owner = 'https://app.trynook.in';
  const secret = 's'.repeat(32);
  assert.deepEqual(parseResidentConfig({}, 'production', owner), {
    residentSmsProvider: 'disabled',
  });
  assert.deepEqual(parseResidentConfig({ RESIDENT_WEB_ORIGIN: '  ' }, 'production', owner), {
    residentSmsProvider: 'disabled',
  });
  const ok = parseResidentConfig(
    { RESIDENT_WEB_ORIGIN: 'https://resident.trynook.in', RESIDENT_OTP_SECRET: secret },
    'production',
    owner,
  );
  assert.equal(ok.residentWebOrigin, 'https://resident.trynook.in');
  assert.equal(ok.residentSmsProvider, 'disabled');
  const rejects = (env: NodeJS.ProcessEnv, appEnv = 'production') =>
    assert.throws(() => parseResidentConfig(env, appEnv, owner));
  rejects({ RESIDENT_WEB_ORIGIN: 'https://resident.trynook.in' }); // no secret
  rejects({ RESIDENT_WEB_ORIGIN: 'https://resident.trynook.in', RESIDENT_OTP_SECRET: 'short' });
  rejects({ RESIDENT_WEB_ORIGIN: owner, RESIDENT_OTP_SECRET: secret }); // same as the owner app
  rejects({ RESIDENT_WEB_ORIGIN: 'http://resident.trynook.in', RESIDENT_OTP_SECRET: secret }); // http in production
  rejects({ RESIDENT_WEB_ORIGIN: 'https://resident.trynook.in/path', RESIDENT_OTP_SECRET: secret });
  rejects({ RESIDENT_WEB_ORIGIN: 'not a url', RESIDENT_OTP_SECRET: secret });
  rejects({ RESIDENT_WEB_ORIGIN: '*', RESIDENT_OTP_SECRET: secret });
  rejects({ RESIDENT_SMS_PROVIDER: 'msg91' }); // no real provider exists yet
  rejects({ RESIDENT_SMS_PROVIDER: 'mock' }); // production refuses the mock
  assert.equal(
    parseResidentConfig({ RESIDENT_SMS_PROVIDER: 'mock' }, 'test', owner).residentSmsProvider,
    'mock',
  );
  assert.equal(
    parseResidentConfig(
      { RESIDENT_WEB_ORIGIN: 'http://localhost:5174', RESIDENT_OTP_SECRET: secret },
      'development',
      'http://localhost:5173',
    ).residentWebOrigin,
    'http://localhost:5174',
  );
});

test('config: loadRuntimeConfig leaves the resident portal off and the SMS provider disabled by default', () => {
  const base = { APP_ENV: 'test', WEB_ORIGIN: 'http://localhost:5173' };
  const config = loadRuntimeConfig({ ...base });
  assert.equal(config.residentWebOrigin, undefined, 'resident portal is off by default');
  assert.equal(config.residentOtpSecret, undefined);
  assert.equal(config.residentSmsProvider, 'disabled');
  assert.equal(
    loadRuntimeConfig({ ...base, RESIDENT_SMS_PROVIDER: 'mock' }).residentSmsProvider,
    'mock',
  );
});

test('sms factory: mock can never be constructed in production; disabled is the default and fails permanently', async () => {
  assert.throws(() => createSmsProvider({ appEnv: 'production', residentSmsProvider: 'mock' }));
  assert.ok(
    createSmsProvider({ appEnv: 'test', residentSmsProvider: 'mock' }) instanceof MockSmsProvider,
  );
  assert.ok(createSmsProvider({ appEnv: 'production' }) instanceof DisabledSmsProvider);
  assert.ok(
    createSmsProvider({ appEnv: 'production', residentSmsProvider: 'disabled' }) instanceof
      DisabledSmsProvider,
  );
  const result = await new SmsDispatcher(new DisabledSmsProvider()).send({
    to: '+919876543210',
    body: 'x',
    reference: 'r',
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failure?.kind, 'permanent');
  assert.equal(result.failure?.code, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(result.attempts, 1, 'a permanent failure is not retried');
});

const FAST = { timeoutMs: 40, maxAttempts: 2, retryDelayMs: 1 };
const message = {
  to: '+919876543210',
  body: 'Your Nook verification code is 654321.',
  reference: 'c-1',
};

test('sms dispatcher: delivery succeeds, result carries no text and no number', async () => {
  const provider = new MockSmsProvider();
  const result = await new SmsDispatcher(provider, FAST).send(message);
  assert.deepEqual(result, { status: 'SENT', attempts: 1, provider: 'mock' });
  assert.ok(
    !JSON.stringify(result).includes('654321') && !JSON.stringify(result).includes('9876543210'),
  );
  assert.equal(provider.lastCodeFor('+919876543210'), '654321');
});

test('sms dispatcher: a transient failure is retried once and then succeeds', async () => {
  const provider = new MockSmsProvider();
  provider.failNext('transient', 'PROVIDER_UNAVAILABLE');
  const result = await new SmsDispatcher(provider, FAST).send(message);
  assert.equal(result.status, 'SENT');
  assert.equal(result.attempts, 2);
  assert.equal(provider.outbox.length, 1);
});

test('sms dispatcher: repeated transient failures stop at the attempt limit and report a structured failure', async () => {
  const provider = new MockSmsProvider();
  provider.failNext('transient', 'PROVIDER_UNAVAILABLE', 5);
  const result = await new SmsDispatcher(provider, FAST).send(message);
  assert.deepEqual(result, {
    status: 'FAILED',
    attempts: 2,
    provider: 'mock',
    failure: { kind: 'transient', code: 'PROVIDER_UNAVAILABLE' },
  });
  assert.equal(provider.outbox.length, 0);
});

test('sms dispatcher: a provider that hangs is cut off by the timeout and retried safely', async () => {
  const provider = new MockSmsProvider();
  provider.delayMs = 500;
  const started = Date.now();
  const result = await new SmsDispatcher(provider, FAST).send(message);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failure?.kind, 'timeout');
  assert.equal(result.attempts, 2);
  assert.ok(Date.now() - started < 400, 'bounded by timeout x attempts, not by the provider');
});

test('sms dispatcher: unknown errors are treated as transient, and their text is never surfaced', async () => {
  const provider: SmsProvider = {
    name: 'odd',
    send: () => Promise.reject(new Error('secret provider detail 654321')),
  };
  const result = await new SmsDispatcher(provider, FAST).send(message);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failure?.code, 'PROVIDER_ERROR');
  assert.ok(!JSON.stringify(result).includes('654321'));
  const permanent: SmsProvider = {
    name: 'p',
    send: () => Promise.reject(new SmsDeliveryError('permanent', 'REJECTED')),
  };
  assert.equal((await new SmsDispatcher(permanent, FAST).send(message)).attempts, 1);
});

test('origin allowlist: exact match only; the resident origin reaches resident paths and nothing else', () => {
  const cfg = {
    webOrigin: 'https://app.trynook.in',
    residentWebOrigin: 'https://resident.trynook.in',
  };
  const owner = 'https://app.trynook.in';
  const resident = 'https://resident.trynook.in';
  assert.equal(isOriginAllowed(cfg, owner, '/api/v1/residents'), true);
  assert.equal(isOriginAllowed(cfg, owner, '/api/v1/resident-auth/otp/request'), true);
  assert.equal(isOriginAllowed(cfg, resident, '/api/v1/resident-auth/otp/request'), true);
  assert.equal(isOriginAllowed(cfg, resident, '/api/v1/resident-auth/me?x=1'), true);
  assert.equal(isOriginAllowed(cfg, resident, '/api/v1/me'), true);
  assert.equal(isOriginAllowed(cfg, resident, '/api/v1/me/stay'), true);
  for (const path of [
    '/api/v1/residents',
    '/api/v1/auth/login',
    '/api/v1/finance/invoices',
    '/api/v1/resident-accounts',
    '/api/v1/resident-authx',
    '/api/v1/measure',
    '/api/v1/health',
    '/api/v1/../residents',
  ])
    assert.equal(isOriginAllowed(cfg, resident, path), false, path);
  for (const bad of [
    undefined,
    '',
    '*',
    'null',
    'https://resident.trynook.in/',
    'http://resident.trynook.in',
    'https://resident.trynook.in:444',
    'https://evil.resident.trynook.in',
    'https://resident.trynook.in.evil.test',
    'HTTPS://RESIDENT.TRYNOOK.IN',
  ])
    assert.equal(
      isOriginAllowed(cfg, bad as string, '/api/v1/resident-auth/otp/request'),
      false,
      String(bad),
    );
  assert.equal(
    isOriginAllowed({ webOrigin: owner }, resident, '/api/v1/resident-auth/otp/request'),
    false,
    'no resident origin configured',
  );
});

@Controller('resident-auth')
class ResidentProbe {
  @Post('otp/request')
  r() {
    return { ok: true };
  }
}
@Controller('finance')
class OwnerProbe {
  @Post('payments')
  p() {
    return { ok: true };
  }
}
@Module({ controllers: [ResidentProbe, OwnerProbe] })
class ProbeModule {}

const config: RuntimeConfig = {
  appEnv: 'test',
  port: 0,
  webOrigin: 'https://app.example.test',
  residentWebOrigin: 'https://resident.example.test',
  secureCookies: false,
  trustProxyHops: 0,
  logLevel: 'error',
  sentryEnvironment: 'test',
};

test('CORS over real HTTP: each origin gets exactly its own surface, credentials are allowed, and nothing is wildcarded', async () => {
  const app: INestApplication = await NestFactory.create(ProbeModule, { logger: false });
  configureApp(app, config);
  await app.init();
  try {
    const pre = (origin: string, path: string) =>
      request(app.getHttpServer())
        .options(path)
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    const own = await pre('https://app.example.test', '/api/v1/finance/payments');
    assert.equal(own.headers['access-control-allow-origin'], 'https://app.example.test');
    assert.equal(own.headers['access-control-allow-credentials'], 'true');
    const res = await pre('https://resident.example.test', '/api/v1/resident-auth/otp/request');
    assert.equal(res.headers['access-control-allow-origin'], 'https://resident.example.test');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
    const crossed = await pre('https://resident.example.test', '/api/v1/finance/payments');
    assert.equal(
      crossed.headers['access-control-allow-origin'],
      undefined,
      'the resident origin gets no CORS grant on an owner route',
    );
    const stranger = await pre('https://evil.example.test', '/api/v1/resident-auth/otp/request');
    assert.equal(stranger.headers['access-control-allow-origin'], undefined);
    const actual = await request(app.getHttpServer())
      .post('/api/v1/resident-auth/otp/request')
      .set('Origin', 'https://resident.example.test')
      .send({});
    assert.equal(actual.headers['access-control-allow-origin'], 'https://resident.example.test');
    for (const r of [own, res, crossed, stranger, actual])
      assert.notEqual(r.headers['access-control-allow-origin'], '*');
  } finally {
    await app.close();
  }
});

test('portal eligibility policy: an ACTIVE resident with an ACTIVE account in an ACTIVE organization, nothing looser', () => {
  assert.deepEqual(PORTAL_ELIGIBLE, {
    status: 'ACTIVE',
    organization: { status: 'ACTIVE' },
    resident: { status: 'ACTIVE' },
  });
  // no negation such as "not ARCHIVED": INACTIVE and ARCHIVED can never match
  assert.equal(JSON.stringify(PORTAL_ELIGIBLE).includes('not'), false);
});
