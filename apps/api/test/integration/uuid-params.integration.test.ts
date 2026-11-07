/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// Every route that takes an identifier in its path (or a UUID filter in its query string) answers a malformed one
// with 400 naming the problem, not with a database error (500), and a well-formed unknown one with 404.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';

let app: any;
let server: ReturnType<typeof request>;
let headers: Record<string, string>;

test.before(async () => {
  const passwordHash = await hashTestPassword();
  const orgId = randomUUID();
  const userId = randomUUID();
  const email = `uuid-${randomUUID()}@nook.test.invalid`;
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO organizations (id, name, updated_at) VALUES ($1,'UUID Test',now())`,
      [orgId],
    );
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'U',now())`,
      [userId, email, passwordHash],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'OWNER','ACTIVE')`,
      [randomUUID(), orgId, userId],
    );
    await c.query('COMMIT');
  });
  app = await NestFactory.create(AppModule, { abortOnError: true });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${app.getHttpServer().address().port}`);
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  const set = res.headers['set-cookie'] as unknown as string[];
  const session = set.find((c) => c.startsWith('nook_session='))!.split(';')[0]!;
  const csrf = set.find((c) => c.startsWith('nook_csrf='))!.split(';')[0]!;
  headers = {
    Origin: ORIGIN,
    Cookie: `${session}; ${csrf}`,
    'x-csrf-token': csrf.slice('nook_csrf='.length),
  };
});

test.after(async () => {
  await app.close();
});

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const call = (method: Method, path: string, body?: object) => {
  const r = (server as any)[method](`/api/v1${path}`).set(headers);
  return body === undefined ? r : r.send(body);
};

// [method, path template with {id}]
const ID_ROUTES: [Method, string][] = [
  ['get', '/residents/{id}'],
  ['put', '/residents/{id}'],
  ['delete', '/residents/{id}'],
  ['get', '/check-ins/{id}'],
  ['put', '/check-ins/{id}'],
  ['post', '/check-ins/{id}/check-out'],
  ['get', '/properties/{id}'],
  ['patch', '/properties/{id}'],
  ['post', '/properties/{id}/archive'],
  ['get', '/properties/{id}/floors'],
  ['post', '/properties/{id}/floors'],
  ['get', '/properties/{id}/rooms'],
  ['post', '/properties/{id}/rooms'],
  ['patch', '/floors/{id}'],
  ['post', '/floors/{id}/archive'],
  ['patch', '/rooms/{id}'],
  ['post', '/rooms/{id}/archive'],
  ['get', '/rooms/{id}/beds'],
  ['post', '/rooms/{id}/beds'],
  ['patch', '/beds/{id}'],
  ['post', '/beds/{id}/archive'],
  ['get', '/bookings/{id}'],
  ['put', '/bookings/{id}'],
  ['delete', '/bookings/{id}'],
  ['get', '/admissions/{id}'],
  ['put', '/admissions/{id}'],
  ['delete', '/admissions/{id}'],
  ['get', '/enquiries/{id}'],
  ['put', '/enquiries/{id}'],
  ['delete', '/enquiries/{id}'],
  ['post', '/enquiries/{id}/convert'],
  ['get', '/enquiries/{id}/follow-ups'],
  ['post', '/enquiries/{id}/follow-ups'],
  ['get', '/finance/invoices/{id}'],
  ['post', '/finance/invoices/{id}/issue'],
];

test('a malformed identifier in the path is a 400 that says so, on every route that takes one', async () => {
  const failures: string[] = [];
  for (const [method, template] of ID_ROUTES) {
    for (const bad of ['not-a-uuid', '123', '%20', '00000000-0000-0000-0000-00000000000z']) {
      const path = template.replace('{id}', bad);
      const body = template.endsWith('/beds')
        ? { label: 'B1', operationalStatus: 'IN_SERVICE' }
        : {};
      const res = await call(
        method,
        path,
        method === 'get' || method === 'delete' ? undefined : body,
      );
      if (res.status !== 400 || !/uuid/i.test(JSON.stringify(res.body))) {
        failures.push(
          `${method.toUpperCase()} ${path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 80)}`,
        );
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('a well-formed identifier that does not exist is a 404 on the read routes', async () => {
  const failures: string[] = [];
  for (const path of [
    '/residents/{id}',
    '/check-ins/{id}',
    '/properties/{id}',
    '/bookings/{id}',
    '/admissions/{id}',
    '/enquiries/{id}',
    '/finance/invoices/{id}',
  ]) {
    const res = await call('get', path.replace('{id}', randomUUID()));
    if (res.status !== 404) failures.push(`GET ${path} -> ${res.status}`);
  }
  assert.deepEqual(failures, []);
});

test('filters that should be identifiers or known values are validated, not passed to the database', async () => {
  const failures: string[] = [];
  const propertyId = randomUUID();
  for (const path of [
    '/residents?status=NOPE',
    '/residents?documentVerificationStatus=NOPE',
    '/check-ins?residentId=bad',
    '/check-ins?bedId=bad',
    '/check-ins?status=NOPE',
    `/properties/${propertyId}/rooms?floorId=bad`,
    '/finance/invoices?residentId=bad',
    '/finance/invoices?status=NOPE',
  ]) {
    const res = await call('get', path);
    if (res.status !== 400) failures.push(`GET ${path} -> ${res.status}`);
  }
  assert.deepEqual(failures, []);
});
