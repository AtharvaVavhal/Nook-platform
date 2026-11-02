/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies are untyped */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// Regression coverage for BookingService.create, which previously locked the nonexistent "Bed"
// table (the table is beds) and so failed on every request.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';

let app: any;
let server: ReturnType<typeof request>;
let passwordHash: string;

interface Org {
  orgId: string;
  bedId: string;
  residentId: string;
  headers: Record<string, string>;
}

async function newOrg(): Promise<Org> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const propertyId = randomUUID();
  const floorId = randomUUID();
  const roomId = randomUUID();
  const bedId = randomUUID();
  const residentId = randomUUID();
  const email = `bk-${randomUUID()}@nook.test.invalid`;
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
      orgId,
      `Booking Test ${orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Booking Tester',now())`,
      [userId, email, passwordHash],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'OWNER','ACTIVE')`,
      [randomUUID(), orgId, userId],
    );
    await c.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'P',now())`,
      [propertyId, orgId, `P-${propertyId.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,'F',0,now())`,
      [floorId, orgId, propertyId],
    );
    await c.query(
      `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at) VALUES ($1,$2,$3,$4,'R',now())`,
      [roomId, orgId, propertyId, floorId],
    );
    await c.query(
      `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,'B1',now())`,
      [bedId, orgId, propertyId, roomId],
    );
    await c.query(
      `INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,'Res','Ident',now())`,
      [residentId, orgId],
    );
    await c.query('COMMIT');
  });
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  const set = res.headers['set-cookie'] as unknown as string[];
  const session = set.find((c) => c.startsWith('nook_session='))!.split(';')[0]!;
  const csrf = set.find((c) => c.startsWith('nook_csrf='))!.split(';')[0]!;
  return {
    orgId,
    bedId,
    residentId,
    headers: {
      Origin: ORIGIN,
      Cookie: `${session}; ${csrf}`,
      'x-csrf-token': csrf.slice('nook_csrf='.length),
    },
  };
}

const book = (org: Org, over: Record<string, unknown> = {}) =>
  server
    .post('/api/v1/bookings')
    .set(org.headers)
    .send({
      residentId: org.residentId,
      bedId: org.bedId,
      startDate: '2026-12-01',
      endDate: '2027-03-01',
      monthlyPrice: 5000,
      ...over,
    });

test.before(async () => {
  passwordHash = await hashTestPassword();
  app = await NestFactory.create(AppModule, { abortOnError: true });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${app.getHttpServer().address().port}`);
});

test.after(async () => {
  await app.close();
});

test('booking: the bed table exists under its real name, so creation succeeds', async () => {
  const org = await newOrg();
  const res = await book(org).expect(201);
  assert.equal(res.body.status, 'CONFIRMED');
  assert.equal(res.body.organizationId, org.orgId);
});

test('booking: overlapping bookings for the same bed are rejected', async () => {
  const org = await newOrg();
  await book(org).expect(201);
  await book(org, { startDate: '2027-01-01', endDate: '2027-02-01' }).expect(409);
});

test('booking: concurrent bookings for one bed produce exactly one winner', async () => {
  const org = await newOrg();
  const results = await Promise.all(Array.from({ length: 8 }, () => book(org)));
  assert.equal(
    results.filter((r) => r.status === 201).length,
    1,
    JSON.stringify(results.map((r) => r.status)),
  );
  assert.equal(results.filter((r) => r.status === 409).length, 7);
});

test("booking: another organization's bed or resident cannot be booked", async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  await book(orgA, { bedId: orgB.bedId }).expect(404);
  await book(orgA, { residentId: orgB.residentId }).expect(404);
});
