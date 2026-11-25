import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import request from 'supertest';
import { configureApp, isResidentPath } from '../src/app.setup.js';
import { AccessGuard } from '../src/auth/access.guard.js';
import {
  RequirePermission,
  RequireResidentPermission,
  ResidentSessionOnly,
} from '../src/auth/permissions.js';
import { SessionService } from '../src/auth/session.service.js';
import type { RuntimeConfig } from '../src/config.js';
import { RESIDENT_SESSION_COOKIE } from '../src/resident-auth/policy.js';
import { ResidentSessionService } from '../src/resident-auth/resident-session.service.js';

// Database-independent: the real HTTP configuration (configureApp) and the real global AccessGuard in front of probe controllers.
// The probes return resident-looking data, so if the guard ever let an unauthenticated call through, the leak would show.
const LEAK = 'Aarav-Probe-Resident-Data';

@Controller('me')
class ProbeMeController {
  @Get()
  @RequireResidentPermission('resident.self.read')
  me() {
    return { data: { firstName: LEAK } };
  }
  @Get('stay')
  @RequireResidentPermission('resident.self.read')
  stay() {
    return { data: { status: LEAK } };
  }
}

@Controller('resident-auth')
class ProbeAuthController {
  @Get('me')
  @ResidentSessionOnly()
  me() {
    return { data: { who: LEAK } };
  }
}

@Controller('properties')
class ProbeOwnerController {
  @Get()
  @RequirePermission('resident.read')
  list() {
    return { data: [LEAK] };
  }
}

const noSession = { authenticate: async () => null, identify: async () => null };
const goodResident = {
  authenticate: async (secret: string) =>
    secret === 'good' ? { residentId: 'r', organizationId: 'o' } : null,
  identify: async () => null,
};
let residentSessions: unknown = noSession;

@Module({
  controllers: [ProbeMeController, ProbeAuthController, ProbeOwnerController],
  providers: [
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: SessionService, useValue: { authenticate: async () => null } },
    { provide: ResidentSessionService, useFactory: () => residentSessions },
  ],
})
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

let app: INestApplication;
test.before(async () => {
  app = await NestFactory.create(ProbeModule, { logger: false });
  configureApp(app, config);
  await app.init();
});
test.after(async () => {
  await app.close();
});
const http = () => request(app.getHttpServer());

test('unauthenticated GET /api/v1/me: 401, Cache-Control: no-store, and no resident data in the body', async () => {
  const res = await http().get('/api/v1/me');
  assert.equal(res.status, 401);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.code, 'UNAUTHENTICATED');
  assert.ok(!res.text.includes(LEAK), 'no resident data in the refusal');
  assert.equal(res.body.data, undefined);
});

test('every unauthenticated resident route answers 401 with no-store (query strings included)', async () => {
  for (const path of ['/api/v1/me/stay', '/api/v1/me?x=1', '/api/v1/resident-auth/me']) {
    const res = await http().get(path);
    assert.equal(res.status, 401, path);
    assert.equal(res.headers['cache-control'], 'no-store', path);
    assert.ok(!res.text.includes(LEAK), path);
  }
});

test('an unknown path under a resident prefix (404) is also no-store', async () => {
  const res = await http().get('/api/v1/me/not-a-route');
  assert.equal(res.status, 404);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('scope: owner routes are untouched - an unauthenticated owner route gets no new cache header', async () => {
  const res = await http().get('/api/v1/properties');
  assert.equal(res.status, 401);
  assert.equal(res.headers['cache-control'], undefined);
  assert.ok(!res.text.includes(LEAK));
});

test('the resident prefix match is exact: look-alike paths are not resident paths', () => {
  for (const yes of [
    '/api/v1/me',
    '/api/v1/me/stay',
    '/api/v1/me?x=1',
    '/api/v1/resident-auth/otp/request',
  ])
    assert.equal(isResidentPath(yes), true, yes);
  for (const no of [
    '/api/v1/mel',
    '/api/v1/meeting',
    '/api/v1/resident-accounts',
    '/api/v1/residents',
    '/api/v1/properties',
    '/health',
  ])
    assert.equal(isResidentPath(no), false, no);
});

test('an authenticated resident call is unaffected: 200, body returned, no-store present', async () => {
  residentSessions = goodResident;
  const local = await NestFactory.create(ProbeModule, { logger: false });
  configureApp(local, config);
  await local.init();
  try {
    const res = await request(local.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', `${RESIDENT_SESSION_COOKIE}=good`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.data.firstName, LEAK);
  } finally {
    await local.close();
    residentSessions = noSession;
  }
});
