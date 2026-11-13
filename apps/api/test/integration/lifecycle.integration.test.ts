/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies and pg rows are untyped */
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

// Booking -> admission -> check-in -> check-out, end to end through the API, plus the tenant
// guarantees the composite foreign keys (20261101190000) add at the database level.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';

let app: any;
let server: ReturnType<typeof request>;
let passwordHash: string;

interface Org {
  orgId: string;
  propertyId: string;
  roomId: string;
  headers: Record<string, string>;
  login: Record<string, string>;
}

async function newOrg(): Promise<Org> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const propertyId = randomUUID();
  const floorId = randomUUID();
  const roomId = randomUUID();
  const email = `lc-${randomUUID()}@nook.test.invalid`;
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
      orgId,
      `Lifecycle ${orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Lifecycle Tester',now())`,
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
    propertyId,
    roomId,
    headers: {
      Origin: ORIGIN,
      Cookie: `${session}; ${csrf}`,
      'x-csrf-token': csrf.slice('nook_csrf='.length),
    },
    login: { Cookie: `${session}; ${csrf}` },
  };
}

async function seedBedAndResident(org: Org) {
  const bedId = randomUUID();
  const residentId = randomUUID();
  await withMigratorClient(async (c) => {
    await c.query(
      `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
      [bedId, org.orgId, org.propertyId, org.roomId, `B-${bedId.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,'Res','Ident',now())`,
      [residentId, org.orgId],
    );
  });
  return { bedId, residentId };
}

const send = (method: 'post' | 'put' | 'delete', org: Org, path: string, body: object = {}) =>
  (server as any)[method](`/api/v1${path}`).set(org.headers).send(body);
const count = (sql: string, params: unknown[]) =>
  withMigratorClient(async (c) => Number((await c.query(sql, params)).rows[0].n));

async function bookedAndAdmitted(org: Org) {
  const { bedId, residentId } = await seedBedAndResident(org);
  const booking = await send('post', org, '/bookings', {
    residentId,
    bedId,
    startDate: '2026-12-01',
    endDate: '2027-06-01',
    monthlyPrice: 4200,
  }).expect(201);
  const admission = await send('post', org, '/admissions', {
    bookingId: booking.body.id,
    residentId,
    bedId,
    admissionDate: '2026-12-01',
  }).expect(201);
  await send('put', org, `/admissions/${admission.body.id}`, { status: 'ADMITTED' }).expect(200);
  return {
    bedId,
    residentId,
    bookingId: booking.body.id as string,
    admissionId: admission.body.id as string,
  };
}

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

test('lifecycle: booking -> admission -> check-in -> check-out works with composite keys', async () => {
  const org = await newOrg();
  const ids = await bookedAndAdmitted(org);
  const checkIn = await send('post', org, '/check-ins', {
    admissionId: ids.admissionId,
    residentId: ids.residentId,
    bedId: ids.bedId,
    bookingId: ids.bookingId,
    checkInAt: '2026-12-02T08:00:00Z',
  }).expect(201);
  assert.equal(checkIn.body.status, 'ACTIVE');
  assert.equal(checkIn.body.organizationId, org.orgId);
  const out = await send('post', org, `/check-ins/${checkIn.body.id}/check-out`, {
    residentId: ids.residentId,
    bedId: ids.bedId,
    bookingId: ids.bookingId,
    checkOutAt: '2027-03-01T08:00:00Z',
  }).expect(201);
  assert.equal(out.body.checkInId, checkIn.body.id);
  assert.equal(out.body.organizationId, org.orgId);
  const row = await withMigratorClient(
    async (c) =>
      (await c.query(`SELECT status FROM check_ins WHERE id = $1`, [checkIn.body.id])).rows[0],
  );
  assert.equal(row.status, 'CHECKED_OUT');
});

test('lifecycle: a second admission for the same booking and a second active check-in are refused', async () => {
  const org = await newOrg();
  const ids = await bookedAndAdmitted(org);
  await send('post', org, '/admissions', {
    bookingId: ids.bookingId,
    residentId: ids.residentId,
    bedId: ids.bedId,
    admissionDate: '2026-12-01',
  }).expect(409);
  const body = {
    admissionId: ids.admissionId,
    residentId: ids.residentId,
    bedId: ids.bedId,
    bookingId: ids.bookingId,
    checkInAt: '2026-12-02T08:00:00Z',
  };
  await send('post', org, '/check-ins', body).expect(201);
  await send('post', org, '/check-ins', body).expect(409);
});

test("tenant: another organization's records cannot be linked through the API (nothing is written)", async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await bookedAndAdmitted(orgA);
  const b = await seedBedAndResident(orgB);
  // booking: foreign bed / foreign resident
  await send('post', orgB, '/bookings', {
    residentId: b.residentId,
    bedId: a.bedId,
    startDate: '2026-12-01',
    endDate: '2027-02-01',
    monthlyPrice: 1,
  }).expect(404);
  await send('post', orgB, '/bookings', {
    residentId: a.residentId,
    bedId: b.bedId,
    startDate: '2026-12-01',
    endDate: '2027-02-01',
    monthlyPrice: 1,
  }).expect(404);
  // admission: foreign booking, and own booking with a foreign resident / bed in the body
  await send('post', orgB, '/admissions', {
    bookingId: a.bookingId,
    residentId: b.residentId,
    bedId: b.bedId,
    admissionDate: '2026-12-01',
  }).expect(404);
  const own = await send('post', orgB, '/bookings', {
    residentId: b.residentId,
    bedId: b.bedId,
    startDate: '2026-12-01',
    endDate: '2027-02-01',
    monthlyPrice: 1,
  }).expect(201);
  const badResident = await send('post', orgB, '/admissions', {
    bookingId: own.body.id,
    residentId: a.residentId,
    bedId: b.bedId,
    admissionDate: '2026-12-01',
  });
  assert.ok(
    badResident.status >= 400,
    `cross-org resident must not be accepted, got ${badResident.status}`,
  );
  const badBed = await send('post', orgB, '/admissions', {
    bookingId: own.body.id,
    residentId: b.residentId,
    bedId: a.bedId,
    admissionDate: '2026-12-01',
  });
  assert.ok(badBed.status >= 400, `cross-org bed must not be accepted, got ${badBed.status}`);
  assert.equal(
    await count(`SELECT count(*) n FROM admissions WHERE organization_id = $1`, [orgB.orgId]),
    0,
  );
  // check-in: foreign admission / resident / bed
  await send('post', orgB, '/check-ins', {
    admissionId: a.admissionId,
    residentId: a.residentId,
    bedId: a.bedId,
    bookingId: a.bookingId,
    checkInAt: '2026-12-02T08:00:00Z',
  }).expect(404);
  assert.equal(
    await count(`SELECT count(*) n FROM check_ins WHERE organization_id = $1`, [orgB.orgId]),
    0,
  );
});

test('tenant: the database refuses cross-organization links on every Phase 3.3-3.5 relation', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await bookedAndAdmitted(orgA);
  const ci = await send('post', orgA, '/check-ins', {
    admissionId: a.admissionId,
    residentId: a.residentId,
    bedId: a.bedId,
    bookingId: a.bookingId,
    checkInAt: '2026-12-02T08:00:00Z',
  }).expect(201);
  const b = await seedBedAndResident(orgB);
  // A second org A booking with no admission yet, so the foreign-booking case reaches the FK
  // (an already-admitted booking would trip the unique index on admissions.booking_id first).
  const a2 = await seedBedAndResident(orgA);
  const a2Booking = await send('post', orgA, '/bookings', {
    residentId: a2.residentId,
    bedId: a2.bedId,
    startDate: '2026-12-01',
    endDate: '2027-02-01',
    monthlyPrice: 1,
  }).expect(201);
  // An org A admission with no check-in yet, for the same reason.
  const a3 = await seedBedAndResident(orgA);
  const a3Booking = await send('post', orgA, '/bookings', {
    residentId: a3.residentId,
    bedId: a3.bedId,
    startDate: '2026-12-01',
    endDate: '2027-02-01',
    monthlyPrice: 1,
  }).expect(201);
  const a3Admission = await send('post', orgA, '/admissions', {
    bookingId: a3Booking.body.id,
    residentId: a3.residentId,
    bedId: a3.bedId,
    admissionDate: '2026-12-01',
  }).expect(201);
  await withMigratorClient(async (c) => {
    const reject = (sql: string, params: unknown[], constraint: RegExp) =>
      assert.rejects(
        c.query(sql, params),
        // Composite foreign key (23503) or, for admission/check-in/check-out rows whose references
        // disagree with their parent, the integrity trigger that runs before it (23514).
        (e: any) =>
          (e.code === '23503' && constraint.test(e.constraint ?? '')) || e.code === '23514',
        sql.slice(0, 40),
      );
    // bookings: org B row pointing at org A's resident / bed
    await reject(
      `INSERT INTO bookings (organization_id, resident_id, bed_id, start_date, end_date, monthly_price, status, updated_at) VALUES ($1,$2,$3,now(),now(),1,'CONFIRMED',now())`,
      [orgB.orgId, a.residentId, b.bedId],
      /bookings_resident_id_organization_id_fkey/,
    );
    await reject(
      `INSERT INTO bookings (organization_id, resident_id, bed_id, start_date, end_date, monthly_price, status, updated_at) VALUES ($1,$2,$3,now(),now(),1,'CONFIRMED',now())`,
      [orgB.orgId, b.residentId, a.bedId],
      /bookings_bed_id_organization_id_fkey/,
    );
    // admissions: foreign booking / resident / bed
    const ownBooking = randomUUID();
    await c.query(
      `INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, status, updated_at) VALUES ($1,$2,$3,$4,now(),now(),1,'CONFIRMED',now())`,
      [ownBooking, orgB.orgId, b.residentId, b.bedId],
    );
    const adm = `INSERT INTO admissions (organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at) VALUES ($1,$2,$3,$4,now(),'PENDING',now())`;
    await reject(
      adm,
      [orgB.orgId, a2Booking.body.id, b.residentId, b.bedId],
      /admissions_booking_id_organization_id_fkey/,
    );
    await reject(
      adm,
      [orgB.orgId, ownBooking, a.residentId, b.bedId],
      /admissions_resident_id_organization_id_fkey/,
    );
    await reject(
      adm,
      [orgB.orgId, ownBooking, b.residentId, a.bedId],
      /admissions_bed_id_organization_id_fkey/,
    );
    // check_ins: foreign admission / resident / bed / booking
    const ownAdmission = randomUUID();
    await c.query(
      `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at) VALUES ($1,$2,$3,$4,$5,now(),'ADMITTED',now())`,
      [ownAdmission, orgB.orgId, ownBooking, b.residentId, b.bedId],
    );
    const cin = `INSERT INTO check_ins (organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at) VALUES ($1,$2,$3,$4,$5,now(),'ACTIVE',now())`;
    await reject(
      cin,
      [orgB.orgId, a3Admission.body.id, b.residentId, b.bedId, ownBooking],
      /check_ins_admission_id_organization_id_fkey/,
    );
    await reject(
      cin,
      [orgB.orgId, ownAdmission, a.residentId, b.bedId, ownBooking],
      /check_ins_resident_id_organization_id_fkey/,
    );
    await reject(
      cin,
      [orgB.orgId, ownAdmission, b.residentId, a.bedId, ownBooking],
      /check_ins_bed_id_organization_id_fkey/,
    );
    await reject(
      cin,
      [orgB.orgId, ownAdmission, b.residentId, b.bedId, a.bookingId],
      /check_ins_booking_id_organization_id_fkey/,
    );
    // check_outs: foreign check-in / resident / bed / booking
    const ownCheckIn = randomUUID();
    await c.query(
      `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now(),'ACTIVE',now())`,
      [ownCheckIn, orgB.orgId, ownAdmission, b.residentId, b.bedId, ownBooking],
    );
    const cout = `INSERT INTO check_outs (organization_id, check_in_id, resident_id, bed_id, booking_id, check_out_at, updated_at) VALUES ($1,$2,$3,$4,$5,now(),now())`;
    await reject(
      cout,
      [orgB.orgId, ci.body.id, b.residentId, b.bedId, ownBooking],
      /check_outs_check_in_id_organization_id_fkey/,
    );
    await reject(
      cout,
      [orgB.orgId, ownCheckIn, a.residentId, b.bedId, ownBooking],
      /check_outs_resident_id_organization_id_fkey/,
    );
    await reject(
      cout,
      [orgB.orgId, ownCheckIn, b.residentId, a.bedId, ownBooking],
      /check_outs_bed_id_organization_id_fkey/,
    );
    await reject(
      cout,
      [orgB.orgId, ownCheckIn, b.residentId, b.bedId, a.bookingId],
      /check_outs_booking_id_organization_id_fkey/,
    );
  });
});

test('security: admission writes now require the Origin and CSRF checks like every other module', async () => {
  const org = await newOrg();
  const { bedId, residentId } = await seedBedAndResident(org);
  const booking = await send('post', org, '/bookings', {
    residentId,
    bedId,
    startDate: '2026-12-01',
    endDate: '2027-06-01',
    monthlyPrice: 1,
  }).expect(201);
  const body = { bookingId: booking.body.id, residentId, bedId, admissionDate: '2026-12-01' };
  assert.equal(
    (await server.post('/api/v1/admissions').set('Origin', ORIGIN).set(org.login).send(body))
      .status,
    403,
    'no CSRF token',
  );
  assert.equal(
    (
      await server
        .post('/api/v1/admissions')
        .set({ ...org.headers, Origin: 'https://evil.example' })
        .send(body)
    ).status,
    403,
    'foreign origin',
  );
  assert.equal(
    await count(`SELECT count(*) n FROM admissions WHERE organization_id = $1`, [org.orgId]),
    0,
  );
  const ok = await send('post', org, '/admissions', body).expect(201);
  assert.equal(
    (
      await server
        .put(`/api/v1/admissions/${ok.body.id}`)
        .set('Origin', ORIGIN)
        .set(org.login)
        .send({ status: 'ADMITTED' })
    ).status,
    403,
  );
  assert.equal(
    (await server.delete(`/api/v1/admissions/${ok.body.id}`).set('Origin', ORIGIN).set(org.login))
      .status,
    403,
  );
});

// ---------------------------------------------------------------------------------------------
// Admission property/room ownership and lifecycle consistency (migration 20261101210000)
// ---------------------------------------------------------------------------------------------

/** A second property with its own room inside the same organization. */
async function secondPropertyWithRoom(org: Org) {
  const propertyId = randomUUID();
  const floorId = randomUUID();
  const roomId = randomUUID();
  await withMigratorClient(async (c) => {
    await c.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'P2',now())`,
      [propertyId, org.orgId, `P2-${propertyId.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,'F',0,now())`,
      [floorId, org.orgId, propertyId],
    );
    await c.query(
      `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at) VALUES ($1,$2,$3,$4,'R2',now())`,
      [roomId, org.orgId, propertyId, floorId],
    );
  });
  return { propertyId, roomId };
}

async function bookingFor(org: Org) {
  const seeded = await seedBedAndResident(org);
  const booking = await send('post', org, '/bookings', {
    residentId: seeded.residentId,
    bedId: seeded.bedId,
    startDate: '2026-12-01',
    endDate: '2027-06-01',
    monthlyPrice: 1,
  }).expect(201);
  return { ...seeded, bookingId: booking.body.id as string };
}

test('admission location: own property and room are accepted; the property is derived from a room alone', async () => {
  const org = await newOrg();
  const full = await bookingFor(org);
  const ok = await send('post', org, '/admissions', {
    bookingId: full.bookingId,
    propertyId: org.propertyId,
    roomId: org.roomId,
    admissionDate: '2026-12-01',
  }).expect(201);
  assert.equal(ok.body.propertyId, org.propertyId);
  assert.equal(ok.body.roomId, org.roomId);
  const roomOnly = await bookingFor(org);
  const derived = await send('post', org, '/admissions', {
    bookingId: roomOnly.bookingId,
    roomId: org.roomId,
    admissionDate: '2026-12-01',
  }).expect(201);
  assert.equal(derived.body.propertyId, org.propertyId, 'property derived from the room');
  const none = await bookingFor(org);
  const bare = await send('post', org, '/admissions', {
    bookingId: none.bookingId,
    admissionDate: '2026-12-01',
  }).expect(201);
  assert.equal(bare.body.propertyId, null);
  assert.equal(bare.body.roomId, null);
});

test('admission location: cross-tenant, mismatched and malformed property/room ids get 4xx and write nothing', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const b = await bookingFor(orgB);
  const body = (extra: object) => ({
    bookingId: b.bookingId,
    admissionDate: '2026-12-01',
    ...extra,
  });
  // another organization's property / room (indistinguishable from "not found")
  await send('post', orgB, '/admissions', body({ propertyId: orgA.propertyId })).expect(404);
  await send('post', orgB, '/admissions', body({ roomId: orgA.roomId })).expect(404);
  await send(
    'post',
    orgB,
    '/admissions',
    body({ propertyId: orgB.propertyId, roomId: orgA.roomId }),
  ).expect(404);
  await send('post', orgB, '/admissions', body({ propertyId: randomUUID() })).expect(404);
  // own room, but not in the selected (own) property
  const other = await secondPropertyWithRoom(orgB);
  await send(
    'post',
    orgB,
    '/admissions',
    body({ propertyId: other.propertyId, roomId: orgB.roomId }),
  ).expect(400);
  // malformed identifiers
  for (const bad of ['not-a-uuid', '123', '../etc']) {
    await send('post', orgB, '/admissions', body({ propertyId: bad })).expect(400);
    await send('post', orgB, '/admissions', body({ roomId: bad })).expect(400);
  }
  await send('post', orgB, '/admissions', { ...body({}), bookingId: 'nope' }).expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM admissions WHERE organization_id = $1`, [orgB.orgId]),
    0,
  );
  // a client-supplied organizationId is ignored: the session decides
  await send(
    'post',
    orgB,
    '/admissions',
    body({ organizationId: orgA.orgId, propertyId: orgA.propertyId }),
  ).expect(404);
});

test("admission location: list and detail never expose another organization's property, room or admission", async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await bookingFor(orgA);
  const adm = await send('post', orgA, '/admissions', {
    bookingId: a.bookingId,
    propertyId: orgA.propertyId,
    roomId: orgA.roomId,
    admissionDate: '2026-12-01',
  }).expect(201);
  const listB = await (server as any).get('/api/v1/admissions').set(orgB.headers).expect(200);
  assert.equal(listB.body.items.length, 0);
  assert.ok(
    !JSON.stringify(listB.body).includes(orgA.propertyId) &&
      !JSON.stringify(listB.body).includes(orgA.roomId),
  );
  await (server as any).get(`/api/v1/admissions/${adm.body.id}`).set(orgB.headers).expect(404);
  const listA = await (server as any).get('/api/v1/admissions').set(orgA.headers).expect(200);
  assert.equal(listA.body.items.length, 1);
  assert.equal(listA.body.items[0].property.id, orgA.propertyId);
  assert.equal(listA.body.items[0].room.id, orgA.roomId);
});

test('admission location: the database refuses cross-tenant and mismatched property/room on insert and update', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const b = await bookingFor(orgB);
  const other = await secondPropertyWithRoom(orgB);
  const adm = await send('post', orgB, '/admissions', {
    bookingId: b.bookingId,
    propertyId: orgB.propertyId,
    roomId: orgB.roomId,
    admissionDate: '2026-12-01',
  }).expect(201);
  await withMigratorClient(async (c) => {
    const reject = (sql: string, params: unknown[], msg: RegExp) =>
      assert.rejects(
        c.query(sql, params),
        (e: any) => e.code === '23514' && msg.test(e.message),
        sql.slice(0, 50),
      );
    const insert = `INSERT INTO admissions (organization_id, booking_id, resident_id, bed_id, property_id, room_id, admission_date, status, updated_at)
                    SELECT organization_id, id, resident_id, bed_id, $2, $3, now(), 'PENDING', now() FROM bookings WHERE id = $1`;
    const spare = await bookingFor(orgB);
    await reject(insert, [spare.bookingId, orgA.propertyId, null], /property must belong/);
    await reject(insert, [spare.bookingId, null, orgA.roomId], /room must belong/);
    await reject(insert, [spare.bookingId, other.propertyId, orgB.roomId], /room must belong/);
    await reject(
      `UPDATE admissions SET property_id = $2 WHERE id = $1`,
      [adm.body.id, orgA.propertyId],
      /property must belong/,
    );
    await reject(
      `UPDATE admissions SET room_id = $2 WHERE id = $1`,
      [adm.body.id, orgA.roomId],
      /room must belong/,
    );
    // existing ON DELETE SET NULL behaviour is preserved: deleting an unreferenced-by-beds room nulls the link
    const roomOnly = await bookingFor(orgB);
    const keep = await send('post', orgB, '/admissions', {
      bookingId: roomOnly.bookingId,
      propertyId: other.propertyId,
      roomId: other.roomId,
      admissionDate: '2026-12-01',
    }).expect(201);
    await c.query(`DELETE FROM rooms WHERE id = $1`, [other.roomId]);
    const after = (
      await c.query(`SELECT room_id, property_id FROM admissions WHERE id = $1`, [keep.body.id])
    ).rows[0];
    assert.equal(after.room_id, null);
    assert.equal(after.property_id, other.propertyId);
  });
});

test('lifecycle consistency: ids come from the authoritative record; mismatched same-organization ids are rejected', async () => {
  const org = await newOrg();
  const one = await bookingFor(org);
  const two = await seedBedAndResident(org); // a different resident and bed in the same organization
  // admission: resident / bed must match the booking
  await send('post', org, '/admissions', {
    bookingId: one.bookingId,
    residentId: two.residentId,
    admissionDate: '2026-12-01',
  }).expect(400);
  await send('post', org, '/admissions', {
    bookingId: one.bookingId,
    bedId: two.bedId,
    admissionDate: '2026-12-01',
  }).expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM admissions WHERE organization_id = $1`, [org.orgId]),
    0,
  );
  // ids omitted: derived from the booking
  const adm = await send('post', org, '/admissions', {
    bookingId: one.bookingId,
    admissionDate: '2026-12-01',
  }).expect(201);
  assert.equal(adm.body.residentId, one.residentId);
  assert.equal(adm.body.bedId, one.bedId);
  await send('put', org, `/admissions/${adm.body.id}`, { status: 'ADMITTED' }).expect(200);
  // check-in: resident / bed / booking must match the admission
  const other = await bookingFor(org);
  const base = { admissionId: adm.body.id, checkInAt: '2026-12-02T08:00:00Z' };
  await send('post', org, '/check-ins', { ...base, residentId: two.residentId }).expect(400);
  await send('post', org, '/check-ins', { ...base, bedId: two.bedId }).expect(400);
  await send('post', org, '/check-ins', { ...base, bookingId: other.bookingId }).expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM check_ins WHERE organization_id = $1`, [org.orgId]),
    0,
  );
  const ci = await send('post', org, '/check-ins', base).expect(201); // derived
  assert.equal(ci.body.residentId, one.residentId);
  assert.equal(ci.body.bedId, one.bedId);
  assert.equal(ci.body.bookingId, one.bookingId);
  // check-out: must match the check-in
  const out = (body: object) =>
    send('post', org, `/check-ins/${ci.body.id}/check-out`, {
      checkOutAt: '2027-03-01T08:00:00Z',
      ...body,
    });
  await out({ residentId: two.residentId }).expect(400);
  await out({ bedId: two.bedId }).expect(400);
  await out({ bookingId: other.bookingId }).expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM check_outs WHERE organization_id = $1`, [org.orgId]),
    0,
  );
  const done = await out({}).expect(201);
  assert.equal(done.body.residentId, one.residentId);
  assert.equal(done.body.bookingId, one.bookingId);
  // malformed ids are 400, not a server error
  await send('post', org, '/check-ins', {
    admissionId: 'nope',
    checkInAt: '2026-12-02T08:00:00Z',
  }).expect(400);
  await send('post', org, '/check-ins/not-a-uuid/check-out', {
    checkOutAt: '2027-03-01T08:00:00Z',
  }).expect(400);
});

test('lifecycle consistency: the database refuses mismatched same-organization references', async () => {
  const org = await newOrg();
  const one = await bookingFor(org);
  const two = await bookingFor(org);
  const adm = await send('post', org, '/admissions', {
    bookingId: one.bookingId,
    admissionDate: '2026-12-01',
  }).expect(201);
  await send('put', org, `/admissions/${adm.body.id}`, { status: 'ADMITTED' }).expect(200);
  const ci = await send('post', org, '/check-ins', {
    admissionId: adm.body.id,
    checkInAt: '2026-12-02T08:00:00Z',
  }).expect(201);
  await withMigratorClient(async (c) => {
    const reject = (sql: string, params: unknown[], msg: RegExp) =>
      assert.rejects(
        c.query(sql, params),
        (e: any) => e.code === '23514' && msg.test(e.message),
        sql.slice(0, 40),
      );
    // admission whose resident/bed differ from its booking
    await reject(
      `INSERT INTO admissions (organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at) VALUES ($1,$2,$3,$4,now(),'PENDING',now())`,
      [org.orgId, two.bookingId, one.residentId, two.bedId],
      /match its booking/,
    );
    await reject(
      `UPDATE admissions SET bed_id = $2 WHERE id = $1`,
      [adm.body.id, two.bedId],
      /match its booking/,
    );
    // check-in with a different resident / bed / booking than its admission
    const cin = `INSERT INTO check_ins (organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at) VALUES ($1,$2,$3,$4,$5,now(),'ACTIVE',now())`;
    const spare = await send('post', org, '/admissions', {
      bookingId: two.bookingId,
      admissionDate: '2026-12-01',
    }).expect(201);
    await c.query(`UPDATE admissions SET status = 'ADMITTED' WHERE id = $1`, [spare.body.id]);
    await reject(
      cin,
      [org.orgId, spare.body.id, one.residentId, two.bedId, two.bookingId],
      /match its admission/,
    );
    await reject(
      cin,
      [org.orgId, spare.body.id, two.residentId, one.bedId, two.bookingId],
      /match its admission/,
    );
    await reject(
      cin,
      [org.orgId, spare.body.id, two.residentId, two.bedId, one.bookingId],
      /match its admission/,
    );
    await reject(
      `UPDATE check_ins SET resident_id = $2 WHERE id = $1`,
      [ci.body.id, two.residentId],
      /match its admission/,
    );
    // check-out with a different resident / bed / booking than its check-in
    const cout = `INSERT INTO check_outs (organization_id, check_in_id, resident_id, bed_id, booking_id, check_out_at, updated_at) VALUES ($1,$2,$3,$4,$5,now(),now())`;
    await reject(
      cout,
      [org.orgId, ci.body.id, two.residentId, one.bedId, one.bookingId],
      /match its check-in/,
    );
    await reject(
      cout,
      [org.orgId, ci.body.id, one.residentId, two.bedId, one.bookingId],
      /match its check-in/,
    );
    await reject(
      cout,
      [org.orgId, ci.body.id, one.residentId, one.bedId, two.bookingId],
      /match its check-in/,
    );
    // consistent rows still insert and later status updates (which do not touch these columns) are unaffected
    await c.query(`UPDATE check_ins SET status = 'CHECKED_OUT' WHERE id = $1`, [ci.body.id]);
  });
});

// ---------------------------------------------------------------------------------------------
// Admission updates enforce the same location and identity rules as creation
// ---------------------------------------------------------------------------------------------

const admissionRow = (id: string) =>
  withMigratorClient(
    async (c) => (await c.query(`SELECT * FROM admissions WHERE id = $1`, [id])).rows[0],
  );

test('admission update: location changes are validated like creation, and rejected updates write nothing', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const b = await bookingFor(orgB);
  const other = await secondPropertyWithRoom(orgB);
  const adm = await send('post', orgB, '/admissions', {
    bookingId: b.bookingId,
    propertyId: orgB.propertyId,
    roomId: orgB.roomId,
    admissionDate: '2026-12-01',
  }).expect(201);
  const snapshot = await admissionRow(adm.body.id);
  const put = (body: object) => send('put', orgB, `/admissions/${adm.body.id}`, body);
  // cross-tenant and unknown ids. This admission already has a room, so a different property fails the
  // room-in-property rule first (400); a foreign id and a random id are indistinguishable.
  await put({ propertyId: orgA.propertyId }).expect(400);
  await put({ propertyId: randomUUID() }).expect(400);
  await put({ roomId: orgA.roomId }).expect(404);
  // room outside the selected property, in both directions
  await put({ propertyId: other.propertyId, roomId: orgB.roomId }).expect(400);
  await put({ propertyId: other.propertyId }).expect(400); // existing room belongs to the first property
  // malformed ids and bad values
  await put({ propertyId: 'nope' }).expect(400);
  await put({ roomId: '123' }).expect(400);
  await put({ status: 'EXPLODED' }).expect(400);
  await put({ admissionDate: 'not-a-date' }).expect(400);
  // a rejected update changes nothing, not even the other fields it carried
  await put({ propertyId: orgA.propertyId, notes: 'must not apply' }).expect(400);
  assert.deepEqual(
    await admissionRow(adm.body.id),
    snapshot,
    'row byte-for-byte unchanged after every rejection',
  );
  // valid changes work: new room derives its property; clearing is allowed
  const moved = await put({ roomId: other.roomId }).expect(200);
  assert.equal(moved.body.roomId, other.roomId);
  assert.equal(moved.body.propertyId, other.propertyId, 'the new room decides its property');
  const both = await put({ propertyId: orgB.propertyId, roomId: orgB.roomId }).expect(200);
  assert.equal(both.body.propertyId, orgB.propertyId);
  const cleared = await put({ propertyId: null, roomId: null }).expect(200);
  assert.equal(cleared.body.propertyId, null);
  assert.equal(cleared.body.roomId, null);
  // details and lists still never expose another organization's location
  const listA = await (server as any).get('/api/v1/admissions').set(orgA.headers).expect(200);
  assert.equal(listA.body.items.length, 0);
});

test('admission update: on an admission without a room, a foreign or unknown property is 404 and nothing is written', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const b = await bookingFor(orgB);
  const adm = await send('post', orgB, '/admissions', {
    bookingId: b.bookingId,
    admissionDate: '2026-12-01',
  }).expect(201);
  const snapshot = await admissionRow(adm.body.id);
  const put = (body: object) => send('put', orgB, `/admissions/${adm.body.id}`, body);
  await put({ propertyId: orgA.propertyId }).expect(404);
  await put({ propertyId: randomUUID(), notes: 'must not apply' }).expect(404);
  assert.deepEqual(await admissionRow(adm.body.id), snapshot);
  const ok = await put({ propertyId: orgB.propertyId }).expect(200);
  assert.equal(ok.body.propertyId, orgB.propertyId);
});

test('admission update: resident, bed and booking cannot be changed', async () => {
  const org = await newOrg();
  const one = await bookingFor(org);
  const two = await bookingFor(org);
  const adm = await send('post', org, '/admissions', {
    bookingId: one.bookingId,
    admissionDate: '2026-12-01',
  }).expect(201);
  const snapshot = await admissionRow(adm.body.id);
  const put = (body: object) => send('put', org, `/admissions/${adm.body.id}`, body);
  await put({ residentId: two.residentId }).expect(400);
  await put({ bedId: two.bedId }).expect(400);
  await put({ bookingId: two.bookingId, notes: 'must not apply' }).expect(400);
  assert.deepEqual(await admissionRow(adm.body.id), snapshot);
  await put({
    residentId: one.residentId,
    bedId: one.bedId,
    bookingId: one.bookingId,
    notes: 'repeating is fine',
  }).expect(200);
});

// ------------------------------------------------------------------ input validation (P0 #1)

test('admission: invalid input is a 400 with the field named, and nothing is stored', async () => {
  const org = await newOrg();
  const { bedId, residentId } = await seedBedAndResident(org);
  const booking = await send('post', org, '/bookings', {
    residentId,
    bedId,
    startDate: '2026-12-01',
    endDate: '2027-06-01',
    monthlyPrice: 4200,
  }).expect(201);
  const good = { bookingId: booking.body.id, admissionDate: '2026-12-01' };
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['no booking', { admissionDate: '2026-12-01' }, /bookingId/],
    ['bad booking id', { ...good, bookingId: 'x' }, /bookingId/],
    ['no date', { bookingId: good.bookingId }, /admissionDate/],
    ['garbage date', { ...good, admissionDate: 'tomorrow' }, /admissionDate/],
    ['impossible date', { ...good, admissionDate: '2026-02-30' }, /admissionDate/],
    ['notes not text', { ...good, notes: 5 }, /notes/],
    ['notes too long', { ...good, notes: 'x'.repeat(2001) }, /notes/],
    ['bad room id', { ...good, roomId: 'room' }, /roomId/],
    ['bad property id', { ...good, propertyId: 'p' }, /propertyId/],
  ];
  for (const [label, body, field] of cases) {
    const res = await send('post', org, '/admissions', body);
    assert.equal(res.status, 400, `${label} answered ${res.status}`);
    assert.match(String(res.body.message), field, label);
  }
  for (const raw of [null, [], '"x"']) {
    const res = await (server as any)
      .post('/api/v1/admissions')
      .set(org.headers)
      .set('Content-Type', 'application/json')
      .send(raw === null ? 'null' : raw === '"x"' ? raw : '[]');
    assert.equal(res.status, 400);
  }
  assert.equal(
    await count(`SELECT count(*) n FROM admissions WHERE organization_id = $1`, [org.orgId]),
    0,
  );
  const created = await send('post', org, '/admissions', { ...good, notes: ' ok ' }).expect(201);
  assert.equal(created.body.notes, 'ok');

  // update
  const id = created.body.id as string;
  for (const body of [
    { status: 'DONE' },
    { status: 3 },
    { admissionDate: 'x' },
    { admissionDate: null },
    { notes: [] },
    { bedId: 'x' },
    { roomId: 'x' },
  ]) {
    const res = await send('put', org, `/admissions/${id}`, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} answered ${res.status}`);
  }
  await send('put', org, `/admissions/${id}`, { notes: null }).expect(200);
  // the date itself changes only through an approved correction, and a bundled status change must not slip through
  const refused = await send('put', org, `/admissions/${id}`, {
    admissionDate: '2026-12-05',
    status: 'ADMITTED',
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'CORRECTION_REQUIRED');
  const after = await (server as any).get(`/api/v1/admissions/${id}`).set(org.headers).expect(200);
  assert.equal(after.body.status, 'PENDING');
});

test('admission queries: bad filters and ids are 400, not 500', async () => {
  const org = await newOrg();
  const get = (path: string) => (server as any).get(`/api/v1${path}`).set(org.headers);
  for (const path of [
    '/admissions?status=NOPE',
    '/admissions?residentId=abc',
    '/admissions?bookingId=abc',
    '/admissions?fromDate=abc',
    '/admissions?fromDate=2026-02-01&toDate=2026-01-01',
    '/admissions?status=PENDING&status=ADMITTED',
    '/admissions/not-a-uuid',
  ]) {
    const res = await get(path);
    assert.equal(res.status, 400, `${path} answered ${res.status}`);
  }
  await send('put', org, '/admissions/not-a-uuid', {}).expect(400);
  await send('delete', org, '/admissions/not-a-uuid').expect(400);
  await get('/admissions?status=PENDING&fromDate=2026-01-01').expect(200);
});

test('admission date: must fall inside the booked period, on create, on update, and when the booking changes', async () => {
  const org = await newOrg();
  const { bedId, residentId } = await seedBedAndResident(org);
  const booking = await send('post', org, '/bookings', {
    residentId,
    bedId,
    startDate: '2026-12-01',
    endDate: '2027-03-01', // exclusive: the last booked day is 28 Feb
    monthlyPrice: 4200,
  }).expect(201);
  const bookingId = booking.body.id as string;
  const admit = (admissionDate: string) =>
    send('post', org, '/admissions', { bookingId, admissionDate });

  // outside the period: before the start, on the (exclusive) end date, after it
  for (const date of ['2026-11-30', '2027-03-01', '2027-03-02', '2026-01-01']) {
    const res = await admit(date);
    assert.equal(res.status, 400, `${date} answered ${res.status}`);
    assert.match(String(res.body.message), /within the booking period/i);
  }
  assert.equal(
    await count(`SELECT count(*) n FROM admissions WHERE organization_id = $1`, [org.orgId]),
    0,
  );
  // a time on the day is judged by its Asia/Kolkata calendar day
  await admit('2026-11-30T17:00:00Z').expect(400); // 30 Nov 22:30 in India
  const last = await admit('2027-02-28').expect(201); // the last booked day
  const id = last.body.id as string;

  // update: the date is no longer editable here (correction required), notes still are
  for (const date of ['2027-03-01', '2026-11-30', '2026-12-01']) {
    const res = await send('put', org, `/admissions/${id}`, { admissionDate: date });
    assert.equal(res.status, 409, date);
    assert.equal(res.body.code, 'CORRECTION_REQUIRED');
  }
  await send('put', org, `/admissions/${id}`, { notes: 'unrelated edit' }).expect(200);

  // booking dates are no longer editable here either, so the booking cannot be moved out from under its admission
  const putBooking = (body: object) => send('put', org, `/bookings/${bookingId}`, body);
  for (const body of [{ startDate: '2026-12-05' }, { endDate: '2027-01-15', notes: 'shorter' }]) {
    const moved = await putBooking(body);
    assert.equal(moved.status, 409);
    assert.equal(moved.body.code, 'CORRECTION_REQUIRED');
  }
  // a cancelled admission can still be cancelled through its own command
  await send('put', org, `/admissions/${id}`, { status: 'CANCELLED' }).expect(200);
});

test('admission approval with location edits returns persisted IDs and audits implicit property changes', async () => {
  const org = await newOrg();
  const b = await bookingFor(org);
  const created = await send('post', org, '/admissions', {
    bookingId: b.bookingId,
    admissionDate: '2026-12-01',
  }).expect(201);
  const updated = await send('put', org, `/admissions/${created.body.id}`, {
    status: 'ADMITTED',
    roomId: org.roomId,
    notes: 'Reviewed metadata',
  }).expect(200);
  assert.equal(updated.body.roomId, org.roomId);
  assert.equal(updated.body.propertyId, org.propertyId);
  assert.equal(updated.body.status, 'ADMITTED');
  await withMigratorClient(async (c) => {
    const events = (
      await c.query(
        "SELECT action,metadata FROM audit_events WHERE organization_id=$1 AND target_id=$2 AND action IN ('admission.updated','admission.approved')",
        [org.orgId, created.body.id],
      )
    ).rows;
    assert.equal(events.length, 2);
    const change = events.find((e) => e.action === 'admission.updated').metadata;
    assert.deepEqual(change.changedFields, ['notes', 'propertyId', 'roomId']);
    assert.deepEqual(change.newValues, {
      notes: 'Reviewed metadata',
      propertyId: org.propertyId,
      roomId: org.roomId,
    });
  });
});
