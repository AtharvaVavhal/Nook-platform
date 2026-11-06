import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Controller, Module, Post, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { CORS_ALLOWED_HEADERS, configureApp } from '../src/app.setup.js';
import type { RuntimeConfig } from '../src/config.js';

// Database-independent: a bare Nest app with the real HTTP configuration (configureApp), one route, no providers.
const WEB_ORIGIN = 'https://app.example.test';

@Controller('finance')
class ProbeController {
  @Post('payments')
  record() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const config: RuntimeConfig = {
  appEnv: 'test',
  port: 0,
  webOrigin: WEB_ORIGIN,
  secureCookies: false,
  trustProxyHops: 0,
  logLevel: 'error',
  sentryEnvironment: 'test',
};

let app: INestApplication;

test.before(async () => {
  app = await NestFactory.create(ProbeModule, { logger: false });
  configureApp(app, config);
  await app.init();
});

test.after(async () => {
  await app.close();
});

function preflight(origin: string, requestHeaders: string) {
  return request(app.getHttpServer())
    .options('/api/v1/finance/payments')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', requestHeaders);
}

test('cors: the allowlist names the payment idempotency header', () => {
  assert.ok(CORS_ALLOWED_HEADERS.includes('Idempotency-Key'));
});

test('cors: a payment preflight from the web origin may send Idempotency-Key', async () => {
  const res = await preflight(WEB_ORIGIN, 'content-type,x-csrf-token,idempotency-key');
  assert.equal(res.status, 204);
  assert.equal(res.headers['access-control-allow-origin'], WEB_ORIGIN);
  assert.equal(res.headers['access-control-allow-credentials'], 'true');
  const allowed = String(res.headers['access-control-allow-headers']).toLowerCase().split(',');
  for (const header of ['content-type', 'x-csrf-token', 'idempotency-key']) {
    assert.ok(allowed.includes(header), `${header} missing from ${allowed}`);
  }
});

test('cors: origin restriction and header allowlist are unchanged', async () => {
  const foreign = await preflight('https://evil.example.test', 'content-type,idempotency-key');
  assert.equal(foreign.headers['access-control-allow-origin'], undefined);
  assert.equal(foreign.headers['access-control-allow-credentials'], undefined);

  const odd = await preflight(WEB_ORIGIN, 'x-evil-header');
  const allowed = String(odd.headers['access-control-allow-headers']).toLowerCase();
  assert.doesNotMatch(allowed, /x-evil-header/);
  assert.notEqual(odd.headers['access-control-allow-origin'], '*');
});
