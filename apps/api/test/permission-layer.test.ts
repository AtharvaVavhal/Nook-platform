/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies are untyped */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Controller, Get, Post, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AccessGuard } from '../src/auth/access.guard.js';
import { loadRuntimeConfig } from '../src/config.js';
import { SessionGuard } from '../src/auth/auth.guards.js';
import type { AuthenticatedContext } from '../src/auth/auth.types.js';
import {
  PERMISSIONS,
  Public,
  RequirePermission,
  ROUTE_ACCESS_KEY,
  SelfService,
  permissionsForRole,
  roleHasPermission,
  type RouteAccess,
} from '../src/auth/permissions.js';
import { SessionService } from '../src/auth/session.service.js';
import { APP_GUARD } from '@nestjs/core';
import { concretePath, listRoutes, type RouteInfo } from './route-inventory.js';

// Database-free tests of the global default-deny permission layer (STAFF milestone, step 0). The PostgreSQL
// behavior baseline and cross-organization isolation are in integration/permission-layer.integration.test.ts.

const SEVEN_CONTROLLERS = [
  'AdmissionController',
  'BookingController',
  'CheckInController',
  'EnquiryController',
  'FinanceController',
  'ResidentController',
  'StaySummaryController',
];

const accessOf = (route: RouteInfo): RouteAccess | undefined =>
  (Reflect.getMetadata(ROUTE_ACCESS_KEY, route.handlerFn) as RouteAccess | undefined) ??
  (Reflect.getMetadata(ROUTE_ACCESS_KEY, route.target) as RouteAccess | undefined);

test('permission table: OWNER and PROPERTY_MANAGER hold every permission; anything else holds none', () => {
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length, 'permission names are unique');
  for (const role of ['OWNER', 'PROPERTY_MANAGER']) {
    for (const permission of PERMISSIONS)
      assert.ok(roleHasPermission(role, permission), `${role} ${permission}`);
    assert.equal(permissionsForRole(role).length, PERMISSIONS.length);
  }
  for (const role of [
    'STAFF',
    'RESIDENT',
    'owner',
    'Owner',
    '',
    ' OWNER',
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
  ]) {
    for (const permission of PERMISSIONS)
      assert.equal(roleHasPermission(role, permission), false, `${role} ${permission}`);
    assert.deepEqual(permissionsForRole(role), []);
  }
  assert.equal(roleHasPermission(undefined, 'inventory.read'), false);
  assert.equal(roleHasPermission(null as any, 'inventory.read'), false);
  assert.equal(roleHasPermission('OWNER', 'not.a.permission' as any), false);
});

let app: INestApplication;
let server: ReturnType<typeof request>;
let routes: RouteInfo[];
let current: Partial<AuthenticatedContext> | null = null;
let authenticateCalls = 0;
const saved = { APP_ENV: process.env.APP_ENV, WEB_ORIGIN: process.env.WEB_ORIGIN };

test.before(async () => {
  process.env.APP_ENV = 'test';
  process.env.WEB_ORIGIN = 'http://localhost:5173';
  // Requests below run real handlers as OWNER/PM. They must never reach a database, so refuse to run at all if one is
  // configured (the CI unit runner passes no database settings; a developer shell with one gets a loud failure).
  assert.equal(
    loadRuntimeConfig().databaseUrl,
    undefined,
    'this unit test must run without a database configured',
  );
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: true });
  app.setGlobalPrefix('api/v1');
  // The session lookup is replaced so any role (including values that cannot exist in the database yet) can be
  // presented. Nothing else is stubbed: real controllers, real guards, real routing.
  (app.get(SessionService, { strict: false }) as any).authenticate = async () => {
    authenticateCalls++;
    return current
      ? {
          sessionId: 's',
          userId: 'u',
          organizationId: 'o',
          organizationName: 'O',
          displayName: 'D',
          passwordChangeRequired: false,
          ...current,
        }
      : null;
  };
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${(app.getHttpServer() as any).address().port}`);
  routes = listRoutes(app);
});

test.after(async () => {
  await app.close();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const call = (route: RouteInfo) => {
  const path = `/api/v1${concretePath(route.path)}`;
  const verb = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const r = (server as any)[verb](path).set('Cookie', 'nook_session=x');
  return verb === 'get' || verb === 'delete' ? r : r.send({});
};

test('every route declares its access, and the declarations are exactly the expected shape', () => {
  assert.ok(routes.length >= 80, `found ${routes.length} routes`);
  const undeclared = routes.filter((r) => !accessOf(r)).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(undeclared, []);
  const publicRoutes = routes
    .filter((r) => accessOf(r)?.kind === 'public')
    .map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(publicRoutes.sort(), [
    'GET /auth/csrf',
    'GET /health',
    'GET /health/database',
    'POST /auth/login',
  ]);
  const selfRoutes = routes
    .filter((r) => accessOf(r)?.kind === 'self')
    .map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(selfRoutes.sort(), ['GET /auth/me', 'POST /auth/logout', 'POST /auth/password']);
  for (const route of routes) {
    const access = accessOf(route)!;
    if (access.kind === 'permission')
      assert.ok(
        (PERMISSIONS as readonly string[]).includes(access.permission),
        `${route.path} ${access.permission}`,
      );
  }
});

test('every permission in the table is used by at least one route (no dead entries)', () => {
  const used = new Set(
    routes.map((r) => accessOf(r)).flatMap((a) => (a?.kind === 'permission' ? [a.permission] : [])),
  );
  assert.deepEqual(
    PERMISSIONS.filter((p) => !used.has(p)),
    [],
  );
});

test('the seven previously session-only controllers expose only permission-protected routes', () => {
  for (const name of SEVEN_CONTROLLERS) {
    const own = routes.filter((r) => r.controller === name);
    assert.ok(own.length > 0, `${name} has routes`);
    for (const route of own) {
      assert.equal(accessOf(route)?.kind, 'permission', `${name} ${route.method} ${route.path}`);
    }
  }
});

test('unknown role (a value that is not OWNER/PROPERTY_MANAGER) is refused on EVERY permission-protected route over real HTTP', async () => {
  const refused: string[] = [];
  const wrong: string[] = [];
  for (const synthetic of ['STAFF', 'RESIDENT', '', 'constructor']) {
    current = { role: synthetic as any };
    for (const route of routes.filter((r) => accessOf(r)?.kind === 'permission')) {
      const res = await call(route);
      if (res.status === 403 && res.body?.code === 'INSUFFICIENT_ROLE')
        refused.push(`${synthetic}|${route.method} ${route.path}`);
      else
        wrong.push(
          `${synthetic}|${route.method} ${route.path} -> ${res.status} ${res.body?.code ?? ''}`,
        );
    }
  }
  assert.deepEqual(wrong, []);
  const permissionRoutes = routes.filter((r) => accessOf(r)?.kind === 'permission').length;
  assert.equal(refused.length, permissionRoutes * 4);
});

test('OWNER and PROPERTY_MANAGER are never stopped by the permission layer', async () => {
  for (const role of ['OWNER', 'PROPERTY_MANAGER'] as const) {
    current = { role };
    for (const route of routes.filter((r) => accessOf(r)?.kind === 'permission')) {
      const res = await call(route);
      const code = res.body?.code ?? res.body?.error?.code ?? '';
      assert.ok(
        !['INSUFFICIENT_ROLE', 'ROUTE_NOT_DECLARED', 'UNAUTHENTICATED'].includes(code) ||
          // The only pre-existing role rule that answers INSUFFICIENT_ROLE for PM is the OWNER-only transfer review list.
          (role === 'PROPERTY_MANAGER' &&
            route.method === 'GET' &&
            route.path === '/transfers/finance-reviews'),
        `${role} ${route.method} ${route.path} -> ${res.status} ${code}`,
      );
    }
  }
});

test('self-service routes accept any role with a session; the temporary-password restriction is still enforced', async () => {
  current = { role: 'STAFF' as any };
  const me = await (server as any).get('/api/v1/auth/me').set('Cookie', 'nook_session=x');
  assert.equal(me.status, 200);
  // Temporary password: only the allow-listed self-service paths work, everything else is refused before any handler.
  current = { role: 'OWNER', passwordChangeRequired: true };
  const blocked = await call(routes.find((r) => r.path === '/residents' && r.method === 'GET')!);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body?.code, 'PASSWORD_CHANGE_REQUIRED');
  const allowed = await (server as any).get('/api/v1/auth/me').set('Cookie', 'nook_session=x');
  assert.equal(allowed.status, 200);
});

test('anonymous callers get 401 on every non-public route and public routes need no session', async () => {
  current = null;
  for (const route of routes) {
    const access = accessOf(route)!;
    const res = await call(route);
    if (access.kind === 'public')
      assert.notEqual(res.body?.code, 'UNAUTHENTICATED', `${route.method} ${route.path}`);
    else assert.equal(res.status, 401, `${route.method} ${route.path}`);
  }
});

test('the session is looked up once per request, not twice (global guard authenticates, SessionGuard is a no-op)', async () => {
  current = { role: 'OWNER' };
  authenticateCalls = 0;
  await (server as any).get('/api/v1/residents').set('Cookie', 'nook_session=x');
  assert.equal(authenticateCalls, 1);
});

test('SessionGuard still authenticates by itself when the global guard has not run', async () => {
  let calls = 0;
  const guard = new SessionGuard({
    authenticate: async () => (calls++, { role: 'OWNER', passwordChangeRequired: false }),
  } as any);
  const request = { headers: { cookie: 'nook_session=abc' }, originalUrl: '/api/v1/x' } as any;
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
  assert.equal(await guard.canActivate(context), true);
  assert.equal(calls, 1);
  assert.equal(request.auth.role, 'OWNER');
  // Already authenticated by the global guard: no second lookup.
  assert.equal(await guard.canActivate(context), true);
  assert.equal(calls, 1);
  // And with no session at all it refuses.
  const anonymous = new SessionGuard({ authenticate: async () => null } as any);
  await assert.rejects(
    () =>
      anonymous.canActivate({
        switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      } as any),
    { status: 401 },
  );
});

test('a route that declares nothing is refused (fail closed); class-level and method-level declarations resolve correctly', async () => {
  @Controller('probe')
  class ProbeController {
    @Get('undeclared')
    undeclared() {
      return { reached: true };
    }
    @Get('open')
    @Public()
    open() {
      return { reached: true };
    }
    @Post('guarded')
    @RequirePermission('inventory.write')
    guarded() {
      return { reached: true };
    }
  }
  @Controller('probe-class')
  @RequirePermission('inventory.read')
  class ClassLevelController {
    @Get('inherits')
    inherits() {
      return { reached: true };
    }
    @Get('overrides')
    @SelfService()
    overrides() {
      return { reached: true };
    }
  }
  let role: string | null = 'OWNER';
  const sessions = {
    authenticate: async () => (role ? { role, passwordChangeRequired: false } : null),
  };
  const { Module } = await import('@nestjs/common');
  const { Reflector } = await import('@nestjs/core');
  @Module({
    controllers: [ProbeController, ClassLevelController],
    providers: [
      { provide: Reflector, useValue: new Reflector() },
      { provide: SessionService, useValue: sessions },
      { provide: APP_GUARD, useClass: AccessGuard },
    ],
  })
  class ProbeModule {}
  const probe = await NestFactory.create(ProbeModule, { logger: false });
  await probe.init();
  await probe.listen(0);
  const s = request(`http://localhost:${(probe.getHttpServer() as any).address().port}`);
  try {
    const undeclared = await s.get('/probe/undeclared');
    assert.equal(undeclared.status, 403);
    assert.equal(undeclared.body.code, 'ROUTE_NOT_DECLARED');
    assert.equal((await s.get('/probe/open')).status, 200);
    assert.equal((await s.post('/probe/guarded')).status, 201);
    assert.equal((await s.get('/probe-class/inherits')).status, 200);
    assert.equal((await s.get('/probe-class/overrides')).status, 200);
    role = 'STAFF';
    assert.equal((await s.post('/probe/guarded')).status, 403);
    assert.equal((await s.get('/probe-class/inherits')).status, 403);
    assert.equal(
      (await s.get('/probe-class/overrides')).status,
      200,
      'self-service route needs only a session',
    );
    assert.equal((await s.get('/probe/undeclared')).status, 403);
    role = null;
    assert.equal((await s.post('/probe/guarded')).status, 401);
    assert.equal((await s.get('/probe/open')).status, 200);
  } finally {
    await probe.close();
  }
});
