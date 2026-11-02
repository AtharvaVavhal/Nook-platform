import assert from 'node:assert/strict';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';
import request from 'supertest';
import { requireTestDatabaseUrl } from './helpers/env.js';

// ---- Test configuration ----
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();

const fixturePassword = process.env.TEST_OWNER_PASSWORD;
if (!fixturePassword) {
  throw new Error('TEST_OWNER_PASSWORD environment variable is required');
}

let app: any;
let server: any;
let httpServer: any;

const VALID_EMAIL = 'm3c-owner@nook.test.invalid';
const VALID_PASSWORD = fixturePassword;
const INVALID_PASSWORD = 'WrongPassword';
const UNKNOWN_EMAIL = 'unknown@example.com';

// ---- Setup NestJS app ----
test.before(async () => {
  app = await NestFactory.create(AppModule, { abortOnError: true });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address();
  const baseUrl = `http://localhost:${address.port}`;
  server = request(baseUrl);
});

test.after(async () => {
  await app.close();
});

// ---- Integration tests ----
test('POST /api/v1/auth/login - valid credentials', async () => {
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: VALID_EMAIL, password: VALID_PASSWORD })
    .expect(200);
  assert.ok(res.body.data.user);
  assert.equal(res.body.data.user.id, '00000000-0000-4000-8000-000000000102');
  const cookies = res.headers['set-cookie'];
  const sessionCookie = cookies.find((c: string) => c.startsWith('nook_session='));
  const csrfCookie = cookies.find((c: string) => c.startsWith('nook_csrf='));
  assert.ok(sessionCookie);
  assert.ok(csrfCookie);
  assert.ok(sessionCookie.includes('HttpOnly'));
  assert.ok(sessionCookie.includes('SameSite=Strict'));
});

test('POST /api/v1/auth/login - invalid password', async () => {
  await server
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: VALID_EMAIL, password: INVALID_PASSWORD })
    .expect(401);
});

test('POST /api/v1/auth/login - unknown identifier', async () => {
  await server
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: UNKNOWN_EMAIL, password: 'anything' })
    .expect(401);
});

test('GET /api/v1/auth/csrf returns token and sets cookie', async () => {
  const res = await server
    .get('/api/v1/auth/csrf')
    .set('Origin', 'http://localhost:5173')
    .expect(200);
  assert.ok(res.body.data.csrfToken);
  const cookies = res.headers['set-cookie'];
  const csrfCookie = cookies.find((c: string) => c.startsWith('nook_csrf='));
  assert.ok(csrfCookie);
});

test('GET /api/v1/auth/me - authenticated', async () => {
  // login first
  const loginRes = await server
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: VALID_EMAIL, password: VALID_PASSWORD })
    .expect(200);
  const cookieHeader = loginRes.headers['set-cookie'];
  const sessionCookie = cookieHeader.find((c: string) => c.startsWith('nook_session='));
  const csrfCookie = cookieHeader.find((c: string) => c.startsWith('nook_csrf='));

  const meRes = await server
    .get('/api/v1/auth/me')
    .set('Cookie', [sessionCookie, csrfCookie].join('; '))
    .expect(200);
  assert.equal(meRes.body.data.user.id, '00000000-0000-4000-8000-000000000102');
  assert.equal(meRes.body.data.user.organization.id, '00000000-0000-4000-8000-000000000101');
});

test('GET /api/v1/auth/me - missing session returns 401', async () => {
  await server
    .get('/api/v1/auth/me')
    .set('Origin', 'http://localhost:5173')
    .expect(401);
});

test('POST /api/v1/auth/logout - revokes session', async () => {
  // login
  const loginRes = await server
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: VALID_EMAIL, password: VALID_PASSWORD })
    .expect(200);
  const cookieHeader = loginRes.headers['set-cookie'];
  const sessionCookie = cookieHeader.find((c: string) => c.startsWith('nook_session='));
  const csrfCookie = cookieHeader.find((c: string) => c.startsWith('nook_csrf='));
  const csrfToken = cookieHeader
    .find((c: string) => c.startsWith('nook_csrf='))
    ?.split(';')[0]
    ?.split('=')[1];

  await server
    .post('/api/v1/auth/logout')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', [sessionCookie, csrfCookie].join('; '))
    .set('x-csrf-token', csrfToken!)
    .expect(200);

  // subsequent request with same session should fail
  await server
    .get('/api/v1/auth/me')
    .set('Cookie', [sessionCookie, csrfCookie].join('; '))
    .expect(401);
});

test('CSRF guard rejects missing token', async () => {
  // login
  const loginRes = await server
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: VALID_EMAIL, password: VALID_PASSWORD })
    .expect(200);
  const cookieHeader = loginRes.headers['set-cookie'];
  const sessionCookie = cookieHeader.find((c: string) => c.startsWith('nook_session='));
  const csrfCookie = cookieHeader.find((c: string) => c.startsWith('nook_csrf='));

  await server
    .post('/api/v1/auth/logout')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', [sessionCookie, csrfCookie].join('; '))
    .expect(403);
});

test('Origin guard rejects disallowed origin on login', async () => {
  await server
    .post('/api/v1/auth/login')
    .set('Origin', 'http://evil.com')
    .send({ email: VALID_EMAIL, password: VALID_PASSWORD })
    .expect(403);
});