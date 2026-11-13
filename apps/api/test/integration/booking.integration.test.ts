/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { createMigratorClient, withMigratorClient, withRuntimeClient } from './helpers/db.js';
import { migratorRoleName } from './helpers/env.js';
import { todayIst } from '../../src/common/time.js';
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
  userId: string;
  bedId: string;
  residentId: string;
  headers: Record<string, string>;
}

async function newOrg(role: 'OWNER' | 'PROPERTY_MANAGER' = 'OWNER'): Promise<Org> {
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
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
      [randomUUID(), orgId, userId, role],
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
    userId,
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

// ---------------------------------------------------- shared helpers for the concurrency regression tests

/** Live (not cancelled) bookings on a bed, read straight from the database. */
const liveBookingsOn = (bedId: string) =>
  withMigratorClient(async (c) =>
    Number(
      (
        await c.query(
          `SELECT count(*) n FROM bookings WHERE bed_id = $1 AND status <> 'CANCELLED'`,
          [bedId],
        )
      ).rows[0].n,
    ),
  );

/** Pairs of live bookings on one bed whose Asia/Kolkata day ranges overlap (half-open). Must always be 0. */
const overlapCount = (orgId: string) =>
  withMigratorClient(async (c) =>
    Number(
      (
        await c.query(
          `SELECT count(*) n FROM bookings a JOIN bookings b
             ON a.bed_id = b.bed_id AND a.id < b.id
            AND (a.start_date AT TIME ZONE 'Asia/Kolkata')::date < (b.end_date AT TIME ZONE 'Asia/Kolkata')::date
            AND (b.start_date AT TIME ZONE 'Asia/Kolkata')::date < (a.end_date AT TIME ZONE 'Asia/Kolkata')::date
           WHERE a.organization_id = $1 AND a.status <> 'CANCELLED' AND b.status <> 'CANCELLED'`,
          [orgId],
        )
      ).rows[0].n,
    ),
  );

/** A second bed in the same room as the organization's first. */
async function addBed(org: Org, label: string): Promise<string> {
  const bedId = randomUUID();
  await withMigratorClient(async (c) => {
    const { rows } = await c.query(
      `SELECT property_id, room_id FROM beds WHERE id = $1 AND organization_id = $2`,
      [org.bedId, org.orgId],
    );
    await c.query(
      `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
      [bedId, org.orgId, rows[0].property_id, rows[0].room_id, label],
    );
  });
  return bedId;
}

/**
 * Holds a row lock in a separate session so a test decides exactly when a request may proceed, instead of
 * hoping two requests interleave. Always release it in a finally block.
 */
async function holdRowLock(table: 'beds' | 'bookings', id: string) {
  const client = createMigratorClient();
  await client.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM ${table} WHERE id = $1::uuid FOR UPDATE`, [id]);
    const pid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    return {
      pid,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await client.query('COMMIT');
        } finally {
          await client.end();
        }
      },
    };
  } catch (error) {
    released = true;
    await client.end();
    throw error;
  }
}

/** Backends currently waiting on a lock held by the given backend. */
const waitersOn = (pid: number) =>
  withMigratorClient(async (c) =>
    Number(
      (
        await c.query(
          `SELECT count(*) n FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))`,
          [pid],
        )
      ).rows[0].n,
    ),
  );

/** Backends in this database waiting on any lock. */
const blockedBackends = () =>
  withMigratorClient(async (c) =>
    Number(
      (
        await c.query(
          `SELECT count(*) n FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`,
        )
      ).rows[0].n,
    ),
  );

/** Polls observable database state (not a fixed delay) until it holds, or fails the test. */
async function waitFor(what: string, condition: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

/** Starts a supertest request now and returns a promise for its response. */
const fire = <T>(req: PromiseLike<T>): Promise<T> => Promise.resolve(req).then((r) => r);

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
  // the response codes are not enough: exactly one live booking may exist for the bed
  assert.equal(await liveBookingsOn(org.bedId), 1);
  assert.equal(await overlapCount(org.orgId), 0);
});

test("booking: another organization's bed or resident cannot be booked", async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  await book(orgA, { bedId: orgB.bedId }).expect(404);
  await book(orgA, { residentId: orgB.residentId }).expect(404);
});

// ------------------------------------------------------------ extensions (4F.1)

const extend = (org: Org, bookingId: string, body: Record<string, unknown>) =>
  server.post(`/api/v1/bookings/${bookingId}/extend`).set(org.headers).send(body);
const audits = (orgId: string, bookingId: string, action = 'booking.extended') =>
  withMigratorClient((c) =>
    c.query(
      `SELECT actor_user_id, metadata, occurred_at FROM audit_events
       WHERE organization_id = $1 AND target_id = $2 AND action = $3 ORDER BY occurred_at`,
      [orgId, bookingId, action],
    ),
  ).then((r) => r.rows);

test('extension: an owner extends a booking with a reason, and the history is preserved', async () => {
  const org = await newOrg();
  const created = await book(org).expect(201);
  const res = await extend(org, created.body.id, {
    newEndDate: '2027-04-01',
    reason: 'Resident asked to stay another month',
  }).expect(201);
  assert.equal(res.body.endDate, '2027-04-01T00:00:00.000Z');
  assert.equal(res.body.extensions.length, 1);
  assert.equal(res.body.extensions[0].previousEndDate, '2027-03-01');
  assert.equal(res.body.extensions[0].newEndDate, '2027-04-01');
  assert.equal(res.body.extensions[0].reason, 'Resident asked to stay another month');
  assert.equal(res.body.extensions[0].approvedByUserId, org.userId);

  // a second extension keeps the first in the history
  const second = await extend(org, created.body.id, {
    newEndDate: '2027-05-01',
    reason: 'Exam season',
  }).expect(201);
  assert.deepEqual(
    second.body.extensions.map((e: any) => [e.previousEndDate, e.newEndDate]),
    [
      ['2027-03-01', '2027-04-01'],
      ['2027-04-01', '2027-05-01'],
    ],
  );
  const rows = await audits(org.orgId, created.body.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].actor_user_id, org.userId);
  assert.equal(rows[0].metadata.reason, 'Resident asked to stay another month');
  assert.ok(rows[0].metadata.approvedAt);
  const read = await server.get(`/api/v1/bookings/${created.body.id}`).set(org.headers).expect(200);
  assert.equal(read.body.extensions.length, 2);
});

test('extension: a property manager may approve as well', async () => {
  const org = await newOrg('PROPERTY_MANAGER');
  const created = await book(org).expect(201);
  await extend(org, created.body.id, {
    newEndDate: '2027-04-01',
    reason: 'Manager approval',
  }).expect(201);
  const [row] = await audits(org.orgId, created.body.id);
  assert.equal(row.metadata.approvedByRole, 'PROPERTY_MANAGER');
});

test('extension: validation - reason and a later end date are required', async () => {
  const org = await newOrg();
  const created = await book(org).expect(201);
  const id = created.body.id;
  await extend(org, id, { newEndDate: '2027-04-01' }).expect(400);
  await extend(org, id, { newEndDate: '2027-04-01', reason: '   ' }).expect(400);
  await extend(org, id, { newEndDate: '2027-04-01', reason: 'x'.repeat(501) }).expect(400);
  await extend(org, id, { reason: 'no date' }).expect(400);
  await extend(org, id, { newEndDate: 'soon', reason: 'bad date' }).expect(400);
  await extend(org, id, { newEndDate: '2027-02-30', reason: 'impossible date' }).expect(400);
  await extend(org, id, { newEndDate: '2027-03-01', reason: 'same end date' }).expect(400);
  await extend(org, id, { newEndDate: '2027-02-01', reason: 'earlier end date' }).expect(400);
  assert.equal((await audits(org.orgId, id)).length, 0, 'rejected requests write nothing');
  const unchanged = await server.get(`/api/v1/bookings/${id}`).set(org.headers).expect(200);
  assert.equal(unchanged.body.endDate, '2027-03-01T00:00:00.000Z');
});

test('extension: an overlapping booking on the same bed blocks it', async () => {
  const org = await newOrg();
  const first = await book(org).expect(201);
  await book(org, { startDate: '2027-03-01', endDate: '2027-04-01' }).expect(201); // back-to-back is fine
  await extend(org, first.body.id, {
    newEndDate: '2027-03-15',
    reason: 'overlaps the next one',
  }).expect(409);
  assert.equal((await audits(org.orgId, first.body.id)).length, 0);
});

test('extension: a cancelled booking cannot be extended; cross-organization is 404', async () => {
  const org = await newOrg();
  const other = await newOrg();
  const created = await book(org).expect(201);
  await extend(other, created.body.id, { newEndDate: '2027-04-01', reason: 'not mine' }).expect(
    404,
  );
  await extend(org, randomUUID(), { newEndDate: '2027-04-01', reason: 'unknown' }).expect(404);
  await extend(org, 'not-a-uuid', { newEndDate: '2027-04-01', reason: 'bad id' }).expect(404);
  await server.delete(`/api/v1/bookings/${created.body.id}`).set(org.headers).expect(200);
  await extend(org, created.body.id, { newEndDate: '2027-04-01', reason: 'cancelled' }).expect(409);
});

test('extension: requires a session, a matching origin and a CSRF token', async () => {
  const org = await newOrg();
  const created = await book(org).expect(201);
  const url = `/api/v1/bookings/${created.body.id}/extend`;
  const body = { newEndDate: '2027-04-01', reason: 'no auth' };
  await server.post(url).set('Origin', ORIGIN).send(body).expect(401);
  await server
    .post(url)
    .set({ ...org.headers, 'x-csrf-token': 'wrong' })
    .send(body)
    .expect(403);
  await server
    .post(url)
    .set({ ...org.headers, Origin: 'http://evil.example' })
    .send(body)
    .expect(403);
});

test('extension: concurrent extension and a new booking for the same bed produce exactly one winner', async () => {
  for (let round = 0; round < 6; round += 1) {
    const org = await newOrg();
    const first = await book(org).expect(201);
    const pair = await Promise.all([
      extend(org, first.body.id, { newEndDate: '2027-04-01', reason: 'race: extend' }),
      book(org, { startDate: '2027-03-01', endDate: '2027-04-01' }),
    ]);
    const wins = pair.filter((r) => r.status === 201).length;
    const losses = pair.filter((r) => r.status === 409).length;
    assert.equal(wins, 1, JSON.stringify(pair.map((r) => r.status)));
    assert.equal(losses, 1);
    const overlaps = await withMigratorClient((c) =>
      c.query(
        `SELECT count(*)::int n FROM bookings a JOIN bookings b
           ON a.bed_id = b.bed_id AND a.id < b.id AND a.start_date < b.end_date AND b.start_date < a.end_date
         WHERE a.organization_id = $1 AND a.status <> 'CANCELLED' AND b.status <> 'CANCELLED'`,
        [org.orgId],
      ),
    );
    assert.equal(overlaps.rows[0].n, 0, 'the bed is never double-booked');
  }
});

test('extension: concurrent extensions never lose or duplicate history', async () => {
  const org = await newOrg();
  const created = await book(org).expect(201);
  const results = await Promise.all(
    ['2027-04-01', '2027-05-01', '2027-06-01'].map((d) =>
      extend(org, created.body.id, { newEndDate: d, reason: `race to ${d}` }),
    ),
  );
  const ok = results.filter((r) => r.status === 201).length;
  assert.ok(ok >= 1);
  const rows = await audits(org.orgId, created.body.id);
  assert.equal(rows.length, ok, 'one audit event per successful extension');
  // each recorded step starts exactly where the previous one ended
  for (let i = 1; i < rows.length; i += 1) {
    assert.equal(rows[i].metadata.previousEndDate, rows[i - 1].metadata.newEndDate);
  }
});

test('booking update: dates and price cannot be changed by PUT (correction required); lengthening stays the extension command', async () => {
  const org = await newOrg();
  const created = await book(org).expect(201);
  const put = (body: object) =>
    server.put(`/api/v1/bookings/${created.body.id}`).set(org.headers).send(body);
  const before = await bookingRow(created.body.id);
  for (const body of [
    { endDate: '2027-04-01' }, // would lengthen
    { endDate: '2027-02-01' }, // would shorten
    { startDate: '2026-12-15' },
    { monthlyPrice: '9000' },
    { status: 'CANCELLED', monthlyPrice: '1.00' }, // a bundled status change must not partially succeed
  ]) {
    const res = await put(body);
    assert.equal(res.status, 409, JSON.stringify(body));
    assert.equal(res.body.code, 'CORRECTION_REQUIRED');
  }
  assert.deepEqual(
    await bookingRow(created.body.id),
    before,
    'nothing changed, including the bundled status',
  );
  assert.equal((await audits(org.orgId, created.body.id, 'booking.shortened')).length, 0);
  // lengthening is still the audited extension command
  await extend(org, created.body.id, { newEndDate: '2027-04-01', reason: 'real extension' }).expect(
    201,
  );
});

test('booking cancellation: refused once a check-in exists, even after check-out; allowed before any', async () => {
  const org = await newOrg();
  const plain = await book(org).expect(201);
  await server.delete(`/api/v1/bookings/${plain.body.id}`).set(org.headers).expect(200);
  const staying = await book(org, { startDate: '2027-06-01', endDate: '2027-09-01' }).expect(201);
  await withMigratorClient(async (c) => {
    const adm = randomUUID();
    const ci = randomUUID();
    await c.query(
      `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,now(),'ADMITTED',now())`,
      [adm, org.orgId, staying.body.id, org.residentId, org.bedId],
    );
    await c.query(
      `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),'CHECKED_OUT',now())`,
      [ci, org.orgId, adm, org.residentId, org.bedId, staying.body.id],
    );
    await c.query(
      `INSERT INTO check_outs (id, organization_id, check_in_id, resident_id, bed_id, booking_id, check_out_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
      [randomUUID(), org.orgId, ci, org.residentId, org.bedId, staying.body.id],
    );
  });
  const refused = await server
    .delete(`/api/v1/bookings/${staying.body.id}`)
    .set(org.headers)
    .expect(409);
  assert.match(refused.body.message, /check-in history/i);
});

// --------------------------------------------- extension history verification (4F.1)

test('extension audit: the stored event carries every required field', async () => {
  const org = await newOrg('PROPERTY_MANAGER');
  const created = await book(org).expect(201);
  const before = Date.now();
  await extend(org, created.body.id, {
    newEndDate: '2027-04-01',
    reason: 'Audit field check',
  }).expect(201);
  const rows = await withMigratorClient((c) =>
    c.query(
      `SELECT organization_id, actor_user_id, action, target_type, target_id, request_id, occurred_at, metadata
         FROM audit_events WHERE organization_id = $1 AND target_id = $2 AND action = 'booking.extended'`,
      [org.orgId, created.body.id],
    ),
  );
  assert.equal(rows.rows.length, 1);
  const [event] = rows.rows;
  assert.equal(event.organization_id, org.orgId);
  assert.equal(event.target_type, 'booking');
  assert.equal(event.target_id, created.body.id);
  assert.equal(event.action, 'booking.extended');
  assert.equal(event.actor_user_id, org.userId);
  assert.ok(event.request_id);
  assert.ok(Math.abs(event.occurred_at.getTime() - before) < 60_000, 'timestamped now');
  assert.equal(event.metadata.approvedByUserId, org.userId);
  assert.equal(event.metadata.approvedByRole, 'PROPERTY_MANAGER');
  assert.equal(event.metadata.previousEndDate, '2027-03-01');
  assert.equal(event.metadata.newEndDate, '2027-04-01');
  assert.equal(event.metadata.reason, 'Audit field check');
  assert.equal(new Date(event.metadata.approvedAt).toString() === 'Invalid Date', false);
  assert.ok(event.metadata.previousEndInstant);
});

test('extension audit: the runtime role can read and add audit rows but never change or remove them', async () => {
  const org = await newOrg();
  const created = await book(org).expect(201);
  await extend(org, created.body.id, {
    newEndDate: '2027-04-01',
    reason: 'Immutability check',
  }).expect(201);
  await withRuntimeClient(async (c) => {
    const who = (await c.query('SELECT current_user u, current_database() d')).rows[0];
    assert.notEqual(who.u, migratorRoleName(), 'running as the runtime role, not the owner');
    const read = await c.query(
      `SELECT count(*)::int n FROM audit_events WHERE target_id = $1 AND action = 'booking.extended'`,
      [created.body.id],
    );
    assert.equal(read.rows[0].n, 1, 'SELECT is allowed');
    // Privileges are inspected, never exercised destructively: TRUNCATE is never executed, even to see it fail.
    const privileges = (
      await c.query(
        `SELECT has_table_privilege(current_user, 'public.audit_events', 'UPDATE') u,
                has_table_privilege(current_user, 'public.audit_events', 'DELETE') d,
                has_table_privilege(current_user, 'public.audit_events', 'TRUNCATE') t`,
      )
    ).rows[0];
    assert.deepEqual(privileges, { u: false, d: false, t: false }, 'no UPDATE, DELETE or TRUNCATE');
    // The refusals are also confirmed on the test's own row, each inside a transaction that is always rolled
    // back, so even a wrongly permitted statement could not leave a change behind.
    const attempts: [string, string][] = [
      [
        'UPDATE must be refused',
        `UPDATE audit_events SET metadata = '{}'::jsonb WHERE target_id = $1`,
      ],
      [
        'UPDATE must be refused',
        `UPDATE audit_events SET actor_user_id = NULL WHERE target_id = $1`,
      ],
      ['DELETE must be refused', `DELETE FROM audit_events WHERE target_id = $1`],
    ];
    for (const [message, sql] of attempts) {
      await c.query('BEGIN');
      try {
        await assert.rejects(
          c.query(sql, [created.body.id]),
          (e: any) => e.code === '42501',
          message,
        );
      } finally {
        await c.query('ROLLBACK');
      }
    }
  });
  const intact = await withMigratorClient((c) =>
    c.query(
      `SELECT metadata->>'reason' r FROM audit_events WHERE target_id = $1 AND action = 'booking.extended'`,
      [created.body.id],
    ),
  );
  assert.deepEqual(
    intact.rows.map((r) => r.r),
    ['Immutability check'],
  );
});

test('extension audit: GET booking returns only the extensions of that booking in that organization', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await book(orgA).expect(201);
  const b = await book(orgB).expect(201);
  await extend(orgA, a.body.id, { newEndDate: '2027-04-01', reason: 'A extension' }).expect(201);
  await extend(orgB, b.body.id, { newEndDate: '2027-05-01', reason: 'B extension' }).expect(201);
  // a forged event: organization B's audit trail naming organization A's booking
  await withMigratorClient((c) =>
    c.query(
      `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id, request_id, metadata)
       VALUES ($1,$2,$3,'booking.extended','booking',$4,$5,$6::jsonb)`,
      [
        randomUUID(),
        orgB.orgId,
        orgB.userId,
        a.body.id,
        randomUUID(),
        JSON.stringify({
          previousEndDate: '2020-01-01',
          newEndDate: '2020-02-01',
          reason: 'forged from org B',
        }),
      ],
    ),
  );
  const readA = await server.get(`/api/v1/bookings/${a.body.id}`).set(orgA.headers).expect(200);
  assert.deepEqual(
    readA.body.extensions.map((e: any) => e.reason),
    ['A extension'],
  );
  const readB = await server.get(`/api/v1/bookings/${b.body.id}`).set(orgB.headers).expect(200);
  assert.deepEqual(
    readB.body.extensions.map((e: any) => e.reason),
    ['B extension'],
  );
  // B cannot read A's booking or its history at all
  await server.get(`/api/v1/bookings/${a.body.id}`).set(orgB.headers).expect(404);
});

// ------------------------------------------------------------------ input validation (P0 #1)

const bookingCount = (orgId: string) =>
  withMigratorClient(async (c) =>
    Number(
      (await c.query(`SELECT count(*) n FROM bookings WHERE organization_id = $1`, [orgId])).rows[0]
        .n,
    ),
  );
const putBooking = (org: Org, id: string, body: unknown) =>
  server
    .put(`/api/v1/bookings/${id}`)
    .set(org.headers)
    .send(body as object);

test('booking create: invalid input is a 400 with the field named, and nothing is stored', async () => {
  const org = await newOrg();
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['end before start', { startDate: '2027-03-01', endDate: '2026-12-01' }, /endDate/],
    ['end equals start', { startDate: '2027-03-01', endDate: '2027-03-01' }, /endDate/],
    ['negative price', { monthlyPrice: -5000 }, /monthlyPrice/],
    ['zero price', { monthlyPrice: 0 }, /monthlyPrice/],
    ['text price', { monthlyPrice: 'abc' }, /monthlyPrice/],
    ['three decimals', { monthlyPrice: '10.123' }, /monthlyPrice/],
    ['price beyond the column', { monthlyPrice: '100000000.00' }, /monthlyPrice/],
    ['huge price', { monthlyPrice: 1e15 }, /monthlyPrice/],
    ['missing price', { monthlyPrice: undefined }, /monthlyPrice/],
    ['garbage start', { startDate: 'abc' }, /startDate/],
    ['impossible day', { endDate: '2027-02-30' }, /endDate/],
    ['absurd year', { endDate: '9999-01-01' }, /endDate/],
    ['bad resident id', { residentId: 'not-a-uuid' }, /residentId/],
    ['missing bed', { bedId: undefined }, /bedId/],
    ['notes not text', { notes: { a: 1 } }, /notes/],
    ['notes too long', { notes: 'x'.repeat(2001) }, /notes/],
  ];
  for (const [label, over, field] of cases) {
    const res = await book(org, over);
    assert.equal(res.status, 400, `${label} answered ${res.status}`);
    assert.match(String(res.body.message), field, label);
  }
  // a body that is not an object
  for (const body of [null, [], 'text', 5]) {
    const res = await server
      .post('/api/v1/bookings')
      .set(org.headers)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));
    assert.equal(res.status, 400, `body ${JSON.stringify(body)} answered ${res.status}`);
  }
  assert.equal(await bookingCount(org.orgId), 0);
});

test('booking create: status and payment status cannot be chosen by the client', async () => {
  const org = await newOrg();
  const res = await book(org, {
    status: 'CANCELLED',
    paymentStatus: 'PAID',
    organizationId: randomUUID(),
  }).expect(201);
  assert.equal(res.body.status, 'CONFIRMED');
  assert.equal(res.body.paymentStatus, 'PENDING');
  assert.equal(res.body.organizationId, org.orgId);
});

test('booking create: valid boundary values are accepted and stored exactly', async () => {
  const org = await newOrg();
  const res = await book(org, {
    monthlyPrice: '99999999.99',
    startDate: '2026-12-01',
    endDate: '2026-12-02',
    notes: '  corner bed ',
  }).expect(201);
  assert.equal(res.body.monthlyPrice, '99999999.99');
  assert.equal(res.body.notes, 'corner bed');
  // a one-night booking is the shortest allowed; a backdated one is allowed (residents already in place)
  const old = await newOrg();
  await book(old, { startDate: '2025-01-01', endDate: '2025-06-01' }).expect(201);
});

test('booking update: invalid input is a 400, a cancelled booking cannot be re-confirmed', async () => {
  const org = await newOrg();
  const created = await book(org).expect(201);
  const id = created.body.id as string;
  for (const body of [
    { status: 'DELETED' },
    { status: 5 },
    { paymentStatus: 'SOON' },
    { monthlyPrice: -1 },
    { monthlyPrice: 'abc' },
    { startDate: 'abc' },
    { endDate: null },
    { notes: 7 },
  ]) {
    const res = await putBooking(org, id, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} answered ${res.status}`);
  }
  const unchanged = await server.get(`/api/v1/bookings/${id}`).set(org.headers).expect(200);
  assert.equal(unchanged.body.startDate.slice(0, 10), '2026-12-01');
  assert.equal(unchanged.body.monthlyPrice, '5000');

  // valid edits still work
  const ok = await putBooking(org, id, {
    notes: 'revised',
    paymentStatus: 'PAID',
  }).expect(200);
  assert.equal(ok.body.paymentStatus, 'PAID');
  // a price change is a correction, not an ordinary edit
  assert.equal((await putBooking(org, id, { monthlyPrice: '5500.50' })).status, 409);
  await putBooking(org, id, { status: 'CONFIRMED' }).expect(200); // already confirmed: harmless

  await putBooking(org, id, { status: 'CANCELLED' }).expect(200);
  const revive = await putBooking(org, id, { status: 'CONFIRMED' });
  assert.equal(revive.status, 409);
  assert.match(String(revive.body.message), /cancelled booking cannot be re-confirmed/i);
  const still = await server.get(`/api/v1/bookings/${id}`).set(org.headers).expect(200);
  assert.equal(still.body.status, 'CANCELLED');
});

test('booking: a cancelled booking cannot be revived on top of a newer one for the same bed', async () => {
  const org = await newOrg();
  const first = await book(org).expect(201);
  await putBooking(org, first.body.id, { status: 'CANCELLED' }).expect(200);
  await book(org).expect(201); // the bed is free again, so a new booking takes it
  await putBooking(org, first.body.id, { status: 'CONFIRMED' }).expect(409);
  const active = await withMigratorClient(async (c) =>
    Number(
      (
        await c.query(
          `SELECT count(*) n FROM bookings WHERE bed_id = $1 AND status = 'CONFIRMED'`,
          [org.bedId],
        )
      ).rows[0].n,
    ),
  );
  assert.equal(active, 1);
});

test('booking queries: bad filters and ids are 400, not 500', async () => {
  const org = await newOrg();
  const get = (path: string) => server.get(`/api/v1${path}`).set(org.headers);
  for (const path of [
    '/bookings?status=NOPE',
    '/bookings?paymentStatus=NOPE',
    '/bookings?residentId=abc',
    '/bookings?bedId=abc',
    '/bookings?fromDate=abc',
    '/bookings?toDate=2026-13-01',
    '/bookings?fromDate=2026-02-01&toDate=2026-01-01',
    '/bookings?status=CONFIRMED&status=CANCELLED',
    '/bookings?page=0',
    '/bookings?limit=1000',
    `/bookings?search=${'x'.repeat(101)}`,
    '/bookings/not-a-uuid',
    '/bookings/beds/available',
    '/bookings/beds/available?startDate=2026-12-01',
    '/bookings/beds/available?startDate=abc&endDate=2026-12-31',
    '/bookings/beds/available?startDate=2026-12-31&endDate=2026-12-01',
    '/bookings/beds/available?startDate=2026-12-01&endDate=2026-12-31&propertyId=x',
  ]) {
    const res = await get(path);
    assert.equal(res.status, 400, `${path} answered ${res.status}`);
  }
  await server.put('/api/v1/bookings/not-a-uuid').set(org.headers).send({}).expect(400);
  await server.delete('/api/v1/bookings/not-a-uuid').set(org.headers).expect(400);
  // valid queries still work
  await get('/bookings?status=CONFIRMED&fromDate=2026-01-01&toDate=2027-01-01').expect(200);
  await get('/bookings/beds/available?startDate=2026-12-01&endDate=2026-12-31').expect(200);
});

// ======================================================= booking concurrency and bed integrity (Phase 1)

/** An admitted admission plus a check-in on the booking, written directly so the test controls the state. */
async function seedStay(
  org: Org,
  bookingId: string,
  opts: { active: boolean; admissionDate: string },
) {
  await withMigratorClient(async (c) => {
    const admissionId = randomUUID();
    const checkInId = randomUUID();
    await c.query(
      `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'ADMITTED',now())`,
      [admissionId, org.orgId, bookingId, org.residentId, org.bedId, opts.admissionDate],
    );
    await c.query(
      `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),$7,now())`,
      [
        checkInId,
        org.orgId,
        admissionId,
        org.residentId,
        org.bedId,
        bookingId,
        opts.active ? 'ACTIVE' : 'CHECKED_OUT',
      ],
    );
    if (!opts.active) {
      await c.query(
        `INSERT INTO check_outs (id, organization_id, check_in_id, resident_id, bed_id, booking_id, check_out_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
        [randomUUID(), org.orgId, checkInId, org.residentId, org.bedId, bookingId],
      );
    }
  });
}

const bookingRow = (id: string) =>
  withMigratorClient(
    async (c) =>
      (
        await c.query(
          `SELECT status, start_date, end_date, monthly_price FROM bookings WHERE id = $1`,
          [id],
        )
      ).rows[0],
  );

test('race: an extension and a new booking on one bed serialize behind the gate and never overlap', async () => {
  const org = await newOrg();
  const a = await book(org, { startDate: '2027-01-01', endDate: '2027-02-01' }).expect(201);
  // Hold booking A's row lock. The extension takes the organization gate, then the bed, then waits on this lock; the new
  // booking must queue behind it instead of deciding on a stale read.
  const holder = await holdRowLock('bookings', a.body.id);
  try {
    const ext = fire(extend(org, a.body.id, { newEndDate: '2027-03-01', reason: 'race' }));
    await waitFor(
      'the extension to be waiting on booking A',
      async () => (await waitersOn(holder.pid)) >= 1,
    );
    let postSettled = false;
    const post = fire(
      book(org, { startDate: '2027-02-15', endDate: '2027-03-15', monthlyPrice: 4100 }),
    ).then((r) => {
      postSettled = true;
      return r;
    });
    await waitFor(
      'the POST to queue behind the extension or to finish',
      async () => postSettled || (await blockedBackends()) >= 2,
    );
    await holder.release();
    const [extRes, postRes] = await Promise.all([ext, post]);
    assert.equal(extRes.status, 201, JSON.stringify(extRes.body));
    assert.equal(postRes.status, 409, JSON.stringify(postRes.body));
  } finally {
    await holder.release();
  }
  assert.equal(await overlapCount(org.orgId), 0, 'no two live bookings overlap on the bed');
  assert.equal(await liveBookingsOn(org.bedId), 1);
  assert.equal((await bookingRow(a.body.id)).end_date.toISOString(), '2027-03-01T00:00:00.000Z');
});

test('race: with the bed locked, an extension and a POST both wait, and exactly one wins either way round', async () => {
  for (let round = 0; round < 4; round += 1) {
    const org = await newOrg();
    const a = await book(org, { startDate: '2027-01-01', endDate: '2027-02-01' }).expect(201);
    const holder = await holdRowLock('beds', org.bedId);
    try {
      const ext = fire(extend(org, a.body.id, { newEndDate: '2027-03-01', reason: 'race' }));
      const post = fire(book(org, { startDate: '2027-02-10', endDate: '2027-03-10' }));
      // One request holds the organization gate and waits for the bed; the other waits for the gate: two blocked backends.
      await waitFor('both requests to be waiting', async () => (await blockedBackends()) >= 2);
      await holder.release();
      const [extRes, postRes] = await Promise.all([ext, post]);
      const outcome = `${extRes.status}/${postRes.status}`;
      assert.ok(outcome === '201/409' || outcome === '409/201', `unexpected outcome ${outcome}`);
    } finally {
      await holder.release();
    }
    assert.equal(await overlapCount(org.orgId), 0, 'no two live bookings overlap on the bed');
  }
});

// Removed: "extension vs PUT start-date change" tested a path that no longer exists (booking dates change only through an
// approved correction). Extension-vs-new-booking races are covered above and at "extension: concurrent extension and a new
// booking". Correction-vs-booking races are in corrections.concurrency.integration.test.ts.

test('half-open periods: a booking that ends the day another starts is adjacent, not overlapping', async () => {
  const org = await newOrg();
  await book(org, { startDate: '2027-01-01', endDate: '2027-02-01' }).expect(201);
  await book(org, { startDate: '2027-02-01', endDate: '2027-03-01' }).expect(201);
  await book(org, { startDate: '2026-12-01', endDate: '2027-01-01' }).expect(201);
  // one day of overlap on either side is still a conflict
  await book(org, { startDate: '2027-01-31', endDate: '2027-02-02' }).expect(409);
  await book(org, { startDate: '2026-12-31', endDate: '2027-01-02' }).expect(409);
  assert.equal(await liveBookingsOn(org.bedId), 3);
  assert.equal(await overlapCount(org.orgId), 0);
});

test('half-open periods: two adjacent bookings requested at the same moment both succeed', async () => {
  const org = await newOrg();
  const [first, second] = await Promise.all([
    book(org, { startDate: '2027-01-01', endDate: '2027-02-01' }),
    book(org, { startDate: '2027-02-01', endDate: '2027-03-01' }),
  ]);
  assert.deepEqual([first.status, second.status], [201, 201]);
  assert.equal(await liveBookingsOn(org.bedId), 2);
  assert.equal(await overlapCount(org.orgId), 0);
});

test('same organization: bookings queue behind the organization gate even on different beds (documented trade-off)', async () => {
  const org = await newOrg();
  const otherBed = await addBed(org, 'B2');
  const holder = await holdRowLock('beds', org.bedId);
  try {
    let firstSettled = false;
    const first = fire(book(org)).then((r) => {
      firstSettled = true;
      return r;
    });
    await waitFor('the first bed request to wait', async () => (await waitersOn(holder.pid)) >= 1);
    // The exclusive gate (specification v1.3 section 10) serializes lifecycle writes of one organization. The booking on
    // the free bed therefore waits behind the one holding the gate, then completes once the lock is released.
    let secondSettled = false;
    const second = fire(book(org, { bedId: otherBed })).then((r) => {
      secondSettled = true;
      return r;
    });
    await waitFor(
      'the second request to queue on the gate',
      async () => (await blockedBackends()) >= 2,
    );
    assert.equal(firstSettled, false);
    assert.equal(secondSettled, false, 'serialization is the price of the exclusive gate');
    await holder.release();
    assert.equal((await first).status, 201);
    const free = await second;
    assert.equal(free.status, 201);
    assert.equal(free.body.bedId, otherBed);
  } finally {
    await holder.release();
  }
  assert.equal(await overlapCount(org.orgId), 0);
  assert.equal(await liveBookingsOn(org.bedId), 1);
  assert.equal(await liveBookingsOn(otherBed), 1);
});

test('tenant: another organization cannot read, change, cancel or extend a booking, and nothing changes', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const b = await book(orgB).expect(201);
  const before = await bookingRow(b.body.id);
  await server.get(`/api/v1/bookings/${b.body.id}`).set(orgA.headers).expect(404);
  await putBooking(orgA, b.body.id, { notes: 'hijack' }).expect(404);
  await putBooking(orgA, b.body.id, { status: 'CANCELLED' }).expect(404);
  await server.delete(`/api/v1/bookings/${b.body.id}`).set(orgA.headers).expect(404);
  await extend(orgA, b.body.id, { newEndDate: '2027-06-01', reason: 'cross tenant' }).expect(404);
  // a bed id from another organization cannot be used to create or to probe availability
  await book(orgA, { bedId: orgB.bedId }).expect(404);
  const list = await server
    .get(`/api/v1/bookings?bedId=${orgB.bedId}`)
    .set(orgA.headers)
    .expect(200);
  assert.equal(list.body.total, 0);
  const free = await server
    .get('/api/v1/bookings/beds/available?startDate=2027-01-01&endDate=2027-02-01')
    .set(orgA.headers)
    .expect(200);
  assert.ok(!free.body.some((bed: any) => bed.id === orgB.bedId));
  const after = await bookingRow(b.body.id);
  assert.deepEqual(after, before, "the other organization's booking is untouched");
  assert.equal((await audits(orgB.orgId, b.body.id)).length, 0);
});

test('bed usability: archived, archived-room and out-of-service beds cannot be booked; nothing is stored', async () => {
  const org = await newOrg();
  const archived = await addBed(org, 'ARCH');
  const outOfService = await addBed(org, 'OOS');
  const roomArchivedBed = randomUUID();
  await withMigratorClient(async (c) => {
    // a separate room, so archiving it affects only this bed and the other two reach their own rule
    const { rows } = await c.query(
      `SELECT r.property_id, r.floor_id FROM rooms r JOIN beds b ON b.room_id = r.id WHERE b.id = $1`,
      [org.bedId],
    );
    const archivedRoom = randomUUID();
    await c.query(
      `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at, archived_at) VALUES ($1,$2,$3,$4,'R-ARCH',now(),now())`,
      [archivedRoom, org.orgId, rows[0].property_id, rows[0].floor_id],
    );
    await c.query(
      `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,'ROOMARCH',now())`,
      [roomArchivedBed, org.orgId, rows[0].property_id, archivedRoom],
    );
    await c.query(`UPDATE beds SET archived_at = now() WHERE id = $1`, [archived]);
    await c.query(`UPDATE beds SET operational_status = 'OUT_OF_SERVICE' WHERE id = $1`, [
      outOfService,
    ]);
  });
  const a = await book(org, { bedId: archived }).expect(409);
  assert.match(a.body.message, /archived/i);
  const o = await book(org, { bedId: outOfService }).expect(409);
  assert.match(o.body.message, /out of service/i);
  const r = await book(org, { bedId: roomArchivedBed }).expect(409);
  assert.match(r.body.message, /archived/i);
  for (const bedId of [archived, outOfService, roomArchivedBed]) {
    assert.equal(await liveBookingsOn(bedId), 0, 'no booking was stored');
  }
});

test('bed usability: a bed with an active check-in cannot be booked for a period that includes today', async () => {
  const org = await newOrg();
  const staying = await book(org, { startDate: '2027-06-01', endDate: '2027-09-01' }).expect(201);
  await seedStay(org, staying.body.id, { active: true, admissionDate: '2027-06-15' });
  const today = todayIst();
  const iso = (offsetDays: number) =>
    new Date(today.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
  const refused = await book(org, { startDate: iso(0), endDate: iso(30) }).expect(409);
  assert.match(refused.body.message, /occupied/i);
  await book(org, { startDate: iso(-10), endDate: iso(10) }).expect(409);
  assert.equal(await liveBookingsOn(org.bedId), 1, 'only the original booking exists');
  // OWNER DECISION PENDING: a booking that starts after today on a bed whose occupant has outstayed
  // their booking is deliberately not asserted here either way.
});

test('rollback: a refused cancel leaves the booking exactly as it was', async () => {
  const org = await newOrg();
  const staying = await book(org, { startDate: '2027-06-01', endDate: '2027-09-01' }).expect(201);
  await seedStay(org, staying.body.id, { active: false, admissionDate: '2027-06-15' });
  const before = await bookingRow(staying.body.id);
  const refused = await putBooking(org, staying.body.id, {
    notes: 'should not stick',
    status: 'CANCELLED',
  }).expect(409);
  assert.match(refused.body.message, /check-in history/i);
  assert.deepEqual(await bookingRow(staying.body.id), before, 'no partial update remains');
  const notes = await withMigratorClient(
    async (c) =>
      (await c.query(`SELECT notes FROM bookings WHERE id = $1`, [staying.body.id])).rows[0].notes,
  );
  assert.notEqual(notes, 'should not stick');
});

// Removed: a date change that would strand the admission date is now a correction validator (LIFECYCLE_CONFLICT); it is
// covered by corrections.service.test.ts rules and the disposable-database correction tests.

test('update keeps its rules: a cancelled booking cannot be revived, and notes/payment edits ignore the booking itself', async () => {
  const org = await newOrg();
  const a = await book(org, { startDate: '2027-01-01', endDate: '2027-02-01' }).expect(201);
  await putBooking(org, a.body.id, { notes: 'same dates, own period' }).expect(200);
  const neighbour = await book(org, { startDate: '2027-02-01', endDate: '2027-03-01' }).expect(201);
  await server.delete(`/api/v1/bookings/${neighbour.body.id}`).set(org.headers).expect(200);
  await putBooking(org, neighbour.body.id, { status: 'CONFIRMED' }).expect(409);
  assert.equal(await overlapCount(org.orgId), 0);
});

// ------------------------------------------------------------ dates: IST business days, mixed input forms

test('dates: date-only, IST-midnight and zoned inputs compare as IST calendar days', async () => {
  const org = await newOrg();
  // A is entered as date-only values (UTC-midnight instants).
  await book(org, { startDate: '2027-01-01', endDate: '2027-02-01' }).expect(201);
  // B starts at IST midnight on the day A ends: adjacent by IST day, although that instant is before A's end instant.
  await book(org, { startDate: '2027-02-01T00:00', endDate: '2027-03-01' }).expect(201);
  // C starts at 05:00 IST on the day B ends, written with an explicit offset.
  await book(org, { startDate: '2027-03-01T05:00:00+05:30', endDate: '2027-04-01' }).expect(201);
  // D starts exactly at IST midnight on the day C ends, written in UTC.
  await book(org, { startDate: '2027-03-31T18:30:00Z', endDate: '2027-05-01' }).expect(201);
  // E starts one minute before IST midnight, which is still C's last day: overlap.
  await book(org, { startDate: '2027-03-31T18:29:00Z', endDate: '2027-05-01' }).expect(409);
  // a zoned timestamp that lands on an IST day inside an existing booking conflicts
  await book(org, { startDate: '2027-01-10T20:00:00Z', endDate: '2027-01-20' }).expect(409);
  assert.equal(await liveBookingsOn(org.bedId), 4);
  assert.equal(await overlapCount(org.orgId), 0);
});

test('dates: availability uses the same IST-day rule as booking creation', async () => {
  const org = await newOrg();
  await book(org, { startDate: '2027-01-01', endDate: '2027-02-01' }).expect(201);
  const availableOn = async (startDate: string, endDate: string) =>
    (
      await server
        .get(`/api/v1/bookings/beds/available?startDate=${startDate}&endDate=${endDate}`)
        .set(org.headers)
        .expect(200)
    ).body.some((bed: any) => bed.id === org.bedId);
  assert.equal(await availableOn('2027-02-01T00:00', '2027-03-01'), true);
  assert.equal(await availableOn('2027-01-31T10:00:00Z', '2027-03-01'), false);
});
