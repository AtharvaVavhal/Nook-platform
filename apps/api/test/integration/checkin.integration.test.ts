/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies and pg rows are untyped */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// Task 4E: check-in / check-out rules and concurrency, through the real API against a real database.
// The concurrency tests fire genuinely simultaneous requests (Promise.all over separate HTTP calls and
// pool connections) and assert the invariant on the database rows afterwards, not on request order.
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
  floorId: string;
  roomId: string;
  headers: Record<string, string>;
}

async function newOrg(): Promise<Org> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const propertyId = randomUUID();
  const floorId = randomUUID();
  const roomId = randomUUID();
  const email = `ci-${randomUUID()}@nook.test.invalid`;
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
      orgId,
      `4E-TEST CheckIn ${orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'4E Tester',now())`,
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
    floorId,
    roomId,
    headers: {
      Origin: ORIGIN,
      Cookie: `${session}; ${csrf}`,
      'x-csrf-token': csrf.slice('nook_csrf='.length),
    },
  };
}

const send = (method: 'post' | 'put' | 'delete' | 'get', org: Org, path: string, body?: object) => {
  const r = (server as any)[method](`/api/v1${path}`).set(org.headers);
  return body === undefined ? r : r.send(body);
};
const sql = <T = any>(query: string, params: unknown[] = []) =>
  withMigratorClient(async (c) => (await c.query(query, params)).rows as T[]);
const n = async (query: string, params: unknown[]) => Number((await sql(query, params))[0].n);

async function seedBed(org: Org) {
  const bedId = randomUUID();
  await sql(
    `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
    [bedId, org.orgId, org.propertyId, org.roomId, `B-${bedId.slice(0, 8)}`],
  );
  return bedId;
}
async function seedResident(org: Org) {
  const residentId = randomUUID();
  await sql(
    `INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,'Res','Ident',now())`,
    [residentId, org.orgId],
  );
  return residentId;
}

/** A booking and an admission for (resident, bed); admitted unless `admit` is false. */
async function stay(
  org: Org,
  who: { bedId?: string; residentId?: string; start?: string; end?: string; admit?: boolean } = {},
) {
  const bedId = who.bedId ?? (await seedBed(org));
  const residentId = who.residentId ?? (await seedResident(org));
  const booking = await send('post', org, '/bookings', {
    residentId,
    bedId,
    startDate: who.start ?? '2026-12-01',
    endDate: who.end ?? '2027-06-01',
    monthlyPrice: 4200,
  }).expect(201);
  const admission = await send('post', org, '/admissions', {
    bookingId: booking.body.id,
    admissionDate: '2026-12-01',
  }).expect(201);
  if (who.admit !== false) {
    await send('put', org, `/admissions/${admission.body.id}`, { status: 'ADMITTED' }).expect(200);
  }
  return {
    bedId,
    residentId,
    bookingId: booking.body.id as string,
    admissionId: admission.body.id as string,
  };
}
type Stay = Awaited<ReturnType<typeof stay>>;
const checkIn = (org: Org, s: Stay, extra: object = {}) =>
  send('post', org, '/check-ins', {
    admissionId: s.admissionId,
    checkInAt: '2026-10-15T08:00:00Z',
    ...extra,
  });
const statuses = (rs: Array<{ status: number }>) => rs.map((r) => r.status).sort((a, b) => a - b);

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

// ───────────────────────────── rules ─────────────────────────────

test('check-in: refused unless the admission is ADMITTED', async () => {
  const org = await newOrg();
  const pending = await stay(org, { admit: false });
  const res = await checkIn(org, pending).expect(409);
  assert.match(res.body.message, /admitted/i);
  const admitted = await stay(org);
  await send('put', org, `/admissions/${admitted.admissionId}`, { status: 'CANCELLED' }).expect(
    200,
  );
  await checkIn(org, admitted).expect(409);
  assert.equal(
    await n(`SELECT count(*) n FROM check_ins WHERE organization_id=$1`, [org.orgId]),
    0,
  );
});

test('check-in: refused when the booking is not CONFIRMED', async () => {
  const org = await newOrg();
  const s = await stay(org);
  await send('put', org, `/bookings/${s.bookingId}`, { status: 'CANCELLED' }).expect(200);
  const res = await checkIn(org, s).expect(409);
  assert.match(res.body.message, /booking/i);
});

test('check-in: archived bed, archived room and out-of-service bed are refused', async () => {
  const org = await newOrg();
  const oos = await stay(org);
  await sql(
    `UPDATE beds SET operational_status='OUT_OF_SERVICE', out_of_service_reason='test' WHERE id=$1`,
    [oos.bedId],
  );
  assert.match((await checkIn(org, oos).expect(409)).body.message, /out of service/i);

  const archivedBed = await stay(org);
  await sql(`UPDATE beds SET archived_at=now() WHERE id=$1`, [archivedBed.bedId]);
  assert.match((await checkIn(org, archivedBed).expect(409)).body.message, /archived/i);

  const archivedRoom = await stay(org);
  await sql(`UPDATE rooms SET archived_at=now() WHERE id=$1`, [org.roomId]);
  assert.match((await checkIn(org, archivedRoom).expect(409)).body.message, /archived/i);
  assert.equal(
    await n(`SELECT count(*) n FROM check_ins WHERE organization_id=$1`, [org.orgId]),
    0,
  );
});

test('check-in: duplicate active check-ins are refused (admission, bed, resident)', async () => {
  const org = await newOrg();
  const first = await stay(org);
  await checkIn(org, first).expect(201);
  assert.match((await checkIn(org, first).expect(409)).body.message, /active check-in/i);

  // Another admission for the same bed (a later booking) while the bed is occupied
  const sameBed = await stay(org, { bedId: first.bedId, start: '2027-06-01', end: '2027-09-01' });
  assert.match((await checkIn(org, sameBed).expect(409)).body.message, /occupied/i);

  // The same resident in a different bed
  const sameResident = await stay(org, { residentId: first.residentId });
  assert.match((await checkIn(org, sameResident).expect(409)).body.message, /resident already/i);
  assert.equal(
    await n(`SELECT count(*) n FROM check_ins WHERE organization_id=$1`, [org.orgId]),
    1,
  );
});

test('check-in: the time defaults to now, and a zone-less time is Asia/Kolkata', async () => {
  const org = await newOrg();
  const a = await stay(org);
  const before = Date.now();
  const created = await send('post', org, '/check-ins', { admissionId: a.admissionId }).expect(201);
  const at = new Date(created.body.checkInAt).getTime();
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, 'defaults to the current instant');

  const b = await stay(org);
  const zoneless = await send('post', org, '/check-ins', {
    admissionId: b.admissionId,
    checkInAt: '2026-12-02T08:00',
  }).expect(201);
  assert.equal(new Date(zoneless.body.checkInAt).toISOString(), '2026-12-02T02:30:00.000Z');
  await send('post', org, '/check-ins', {
    admissionId: (await stay(org)).admissionId,
    checkInAt: 'garbage',
  }).expect(400);
});

test('check-out: optional reason, history kept, booking and admission untouched, repeat refused', async () => {
  const org = await newOrg();
  const s = await stay(org);
  const ci = await checkIn(org, s).expect(201);
  // occupancy comes from the active check-in
  assert.deepEqual(
    (await send('get', org, '/check-ins/occupancy').expect(200)).body.occupiedBedIds,
    [s.bedId],
  );
  // before the check-in time is refused
  await send('post', org, `/check-ins/${ci.body.id}/check-out`, {
    checkOutAt: '2026-10-14T00:00:00Z',
  }).expect(400);
  // no body at all: defaults to now, reason null
  const out = await send('post', org, `/check-ins/${ci.body.id}/check-out`, {}).expect(201);
  assert.equal(out.body.reason, null);
  assert.ok(Math.abs(Date.now() - new Date(out.body.checkOutAt).getTime()) < 10_000);
  // repeated check-out
  const again = await send('post', org, `/check-ins/${ci.body.id}/check-out`, {
    reason: 'late',
  }).expect(409);
  assert.match(again.body.message, /already been checked out/i);

  // history is preserved; nothing was cancelled; occupancy is released
  assert.equal(
    await n(`SELECT count(*) n FROM check_ins WHERE id=$1 AND status='CHECKED_OUT'`, [ci.body.id]),
    1,
  );
  assert.equal(await n(`SELECT count(*) n FROM check_outs WHERE check_in_id=$1`, [ci.body.id]), 1);
  const [row] = await sql(
    `SELECT a.status AS admission, b.status AS booking FROM admissions a JOIN bookings b ON b.id=a.booking_id WHERE a.id=$1`,
    [s.admissionId],
  );
  assert.deepEqual(row, { admission: 'ADMITTED', booking: 'CONFIRMED' });
  assert.deepEqual(
    (await send('get', org, '/check-ins/occupancy').expect(200)).body.occupiedBedIds,
    [],
  );
  // the stay is visible in history with its check-out
  const detail = await send('get', org, `/check-ins/${ci.body.id}`).expect(200);
  assert.equal(detail.body.checkOut.checkInId, ci.body.id);
  // the admission cannot be checked in a second time
  assert.match(
    (await checkIn(org, s).expect(409)).body.message,
    /already been checked in and out/i,
  );
});

test('check-in history cannot be rewritten: status and time are not editable, DELETE is gone', async () => {
  const org = await newOrg();
  const ci = await checkIn(org, await stay(org)).expect(201);
  await send('put', org, `/check-ins/${ci.body.id}`, { status: 'CHECKED_OUT' }).expect(400);
  await send('put', org, `/check-ins/${ci.body.id}`, { checkInAt: '2020-01-01T00:00:00Z' }).expect(
    400,
  );
  const notes = await send('put', org, `/check-ins/${ci.body.id}`, {
    notes: 'late arrival',
  }).expect(200);
  assert.equal(notes.body.notes, 'late arrival');
  assert.equal(notes.body.status, 'ACTIVE');
  await send('delete', org, `/check-ins/${ci.body.id}`).expect(404);
  assert.equal(
    await n(`SELECT count(*) n FROM check_ins WHERE id=$1 AND status='ACTIVE'`, [ci.body.id]),
    1,
  );
});

test('check-in: tenant isolation, CSRF and Origin are enforced', async () => {
  const a = await newOrg();
  const b = await newOrg();
  const s = await stay(a);
  await checkIn(b, s).expect(404);
  const ci = await checkIn(a, s).expect(201);
  await send('get', b, `/check-ins/${ci.body.id}`).expect(404);
  await send('post', b, `/check-ins/${ci.body.id}/check-out`, {}).expect(404);
  assert.equal((await send('get', b, '/check-ins').expect(200)).body.total, 0);
  // no CSRF token / wrong Origin
  const noCsrf = { ...a.headers };
  delete noCsrf['x-csrf-token'];
  await (server as any)
    .post(`/api/v1/check-ins/${ci.body.id}/check-out`)
    .set(noCsrf)
    .send({})
    .expect(403);
  await (server as any)
    .post(`/api/v1/check-ins/${ci.body.id}/check-out`)
    .set({ ...a.headers, Origin: 'http://evil.example' })
    .send({})
    .expect(403);
  await (server as any).get('/api/v1/check-ins').expect(401);
  assert.equal(
    await n(`SELECT count(*) n FROM check_ins WHERE id=$1 AND status='ACTIVE'`, [ci.body.id]),
    1,
  );
});

test('bed availability excludes a bed that has an active check-in, even past its booking end', async () => {
  const org = await newOrg();
  const s = await stay(org, { start: '2026-12-01', end: '2027-01-01' });
  const q = '/bookings/beds/available?startDate=2027-03-01&endDate=2027-04-01';
  const free = (await send('get', org, q).expect(200)).body as Array<{ id: string }>;
  assert.ok(
    free.some((bed) => bed.id === s.bedId),
    'free before check-in (booking ended)',
  );
  const ci = await checkIn(org, s).expect(201);
  const held = (await send('get', org, q).expect(200)).body as Array<{ id: string }>;
  assert.ok(!held.some((bed) => bed.id === s.bedId), 'occupied while checked in');
  await send('post', org, `/check-ins/${ci.body.id}/check-out`, {}).expect(201);
  const released = (await send('get', org, q).expect(200)).body as Array<{ id: string }>;
  assert.ok(
    released.some((bed) => bed.id === s.bedId),
    'free again after check-out',
  );
});

test('an admission or booking with an active check-in cannot be cancelled', async () => {
  const org = await newOrg();
  const s = await stay(org);
  const ci = await checkIn(org, s).expect(201);
  await send('put', org, `/admissions/${s.admissionId}`, { status: 'CANCELLED' }).expect(409);
  await send('put', org, `/admissions/${s.admissionId}`, { status: 'PENDING' }).expect(409);
  await send('put', org, `/bookings/${s.bookingId}`, { status: 'CANCELLED' }).expect(409);
  await send('post', org, `/check-ins/${ci.body.id}/check-out`, {}).expect(201);
  // after check-out they may be cancelled again, but nothing did it automatically
  await send('put', org, `/bookings/${s.bookingId}`, { status: 'CANCELLED' }).expect(200);
});

// ─────────────────────────── concurrency ───────────────────────────

test('concurrency: simultaneous check-ins for the same admission create exactly one', async () => {
  const org = await newOrg();
  const s = await stay(org);
  const results = await Promise.all(Array.from({ length: 8 }, () => checkIn(org, s)));
  assert.deepEqual(statuses(results), [201, 409, 409, 409, 409, 409, 409, 409]);
  assert.equal(
    await n(`SELECT count(*) n FROM check_ins WHERE admission_id=$1`, [s.admissionId]),
    1,
  );
});

test('concurrency: two admissions racing for the same bed — exactly one check-in wins', async () => {
  const org = await newOrg();
  const bedId = await seedBed(org);
  const one = await stay(org, { bedId, start: '2026-12-01', end: '2027-02-01' });
  const two = await stay(org, { bedId, start: '2027-02-01', end: '2027-04-01' });
  const three = await stay(org, { bedId, start: '2027-04-01', end: '2027-06-01' });
  const results = await Promise.all([checkIn(org, one), checkIn(org, two), checkIn(org, three)]);
  assert.deepEqual(statuses(results), [201, 409, 409]);
  assert.equal(
    await n(`SELECT count(*) n FROM check_ins WHERE bed_id=$1 AND status='ACTIVE'`, [bedId]),
    1,
  );
  assert.equal(await n(`SELECT count(*) n FROM check_ins WHERE bed_id=$1`, [bedId]), 1);
});

test('concurrency: one resident racing into two beds — exactly one check-in wins', async () => {
  const org = await newOrg();
  const residentId = await seedResident(org);
  const one = await stay(org, { residentId });
  const two = await stay(org, { residentId });
  const results = await Promise.all([checkIn(org, one), checkIn(org, two)]);
  assert.deepEqual(statuses(results), [201, 409]);
  assert.equal(
    await n(`SELECT count(*) n FROM check_ins WHERE resident_id=$1 AND status='ACTIVE'`, [
      residentId,
    ]),
    1,
  );
});

async function raceWithCancellation(kind: 'booking' | 'admission', rounds: number) {
  const org = await newOrg();
  const outcomes = new Set<string>();
  for (let i = 0; i < rounds; i++) {
    const s = await stay(org);
    const cancel = () =>
      kind === 'booking'
        ? send('put', org, `/bookings/${s.bookingId}`, { status: 'CANCELLED' })
        : send('put', org, `/admissions/${s.admissionId}`, { status: 'CANCELLED' });
    // alternate which request is sent first so neither ordering is favoured
    const pair = i % 2 === 0 ? [checkIn(org, s), cancel()] : [cancel(), checkIn(org, s)];
    const [first, second] = await Promise.all(pair);
    const ci = i % 2 === 0 ? first! : second!;
    const cx = i % 2 === 0 ? second! : first!;
    assert.ok([201, 409].includes(ci.status), `check-in answered ${ci.status}`);
    assert.ok([200, 409].includes(cx.status), `cancel answered ${cx.status}`);
    // exactly one of the two wins
    assert.ok(
      (ci.status === 201) !== (cx.status === 200),
      `both or neither succeeded: ${ci.status}/${cx.status}`,
    );
    // the invariant, read from the database: an ACTIVE check-in never sits on a cancelled booking/admission
    const [row] = await sql(
      `SELECT (SELECT count(*) FROM check_ins WHERE admission_id=$1 AND status='ACTIVE')::int AS active,
              (SELECT status FROM bookings WHERE id=$2) AS booking,
              (SELECT status FROM admissions WHERE id=$1) AS admission`,
      [s.admissionId, s.bookingId],
    );
    if (row.active === 1) assert.deepEqual([row.booking, row.admission], ['CONFIRMED', 'ADMITTED']);
    else assert.ok(row.booking === 'CANCELLED' || row.admission === 'CANCELLED');
    outcomes.add(ci.status === 201 ? 'check-in won' : 'cancellation won');
  }
  return outcomes;
}

test('concurrency: check-in racing booking cancellation never leaves an active stay on a cancelled booking', async () => {
  const outcomes = await raceWithCancellation('booking', 10);
  console.log('  booking race outcomes seen:', [...outcomes].join(', '));
});

test('concurrency: check-in racing admission cancellation never leaves an active stay on a cancelled admission', async () => {
  const outcomes = await raceWithCancellation('admission', 10);
  console.log('  admission race outcomes seen:', [...outcomes].join(', '));
});

test('concurrency: repeated and simultaneous check-outs record exactly one check-out', async () => {
  const org = await newOrg();
  const s = await stay(org);
  const ci = await checkIn(org, s).expect(201);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      send('post', org, `/check-ins/${ci.body.id}/check-out`, { reason: `attempt ${i}` }),
    ),
  );
  assert.deepEqual(statuses(results), [201, 409, 409, 409, 409, 409, 409, 409]);
  assert.equal(await n(`SELECT count(*) n FROM check_outs WHERE check_in_id=$1`, [ci.body.id]), 1);
  // sequential repeats afterwards are refused too and change nothing
  await send('post', org, `/check-ins/${ci.body.id}/check-out`, {}).expect(409);
  await send('post', org, `/check-ins/${ci.body.id}/check-out`, {}).expect(409);
  assert.equal(await n(`SELECT count(*) n FROM check_outs WHERE check_in_id=$1`, [ci.body.id]), 1);
  const [row] = await sql(`SELECT reason FROM check_outs WHERE check_in_id=$1`, [ci.body.id]);
  assert.match(row.reason, /^attempt \d$/);
});

test('concurrency: check-out racing a check-in of the next admission for the same bed stays consistent', async () => {
  const org = await newOrg();
  const bedId = await seedBed(org);
  const one = await stay(org, { bedId, start: '2026-12-01', end: '2027-02-01' });
  const two = await stay(org, { bedId, start: '2027-02-01', end: '2027-04-01' });
  const ci = await checkIn(org, one).expect(201);
  const [out, next] = await Promise.all([
    send('post', org, `/check-ins/${ci.body.id}/check-out`, {}),
    checkIn(org, two),
  ]);
  assert.equal(out.status, 201);
  assert.ok([201, 409].includes(next.status));
  // never two active check-ins on one bed, whichever order won
  assert.ok(
    (await n(`SELECT count(*) n FROM check_ins WHERE bed_id=$1 AND status='ACTIVE'`, [bedId])) <= 1,
  );
});
