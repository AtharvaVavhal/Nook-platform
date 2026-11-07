/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies and pg rows are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { assertFaultInjectionName, withMigratorClient, withRuntimeClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';

// Requires: DATABASE_URL (runtime role), MIGRATOR_DATABASE_URL (schema owner, used only to
// seed and to assert DB-level guarantees) and TEST_OWNER_PASSWORD, against a database that
// has every migration applied (including 20261101130000_add_finance_billing).
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';

type Cookies = { session: string; csrf: string; token: string };
interface Org {
  orgId: string;
  email: string;
  userId: string;
  propertyId: string;
  roomId: string;
  cookies: Cookies;
}

let app: any;
let server: ReturnType<typeof request>;
let passwordHash: string;

const now = new Date();
const monthStr = now.toISOString().slice(0, 7);
const Y = Number(monthStr.slice(0, 4));
const M = Number(monthStr.slice(5, 7));
const monthStart = new Date(Date.UTC(Y, M - 1, 1));
const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const DAY = 86_400_000;
const prevMonthStr = new Date(Date.UTC(Y, M - 2, 1)).toISOString().slice(0, 7);

async function login(email: string): Promise<Cookies> {
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  const set = res.headers['set-cookie'] as unknown as string[];
  const session = set.find((c) => c.startsWith('nook_session='))!.split(';')[0]!;
  const csrf = set.find((c) => c.startsWith('nook_csrf='))!.split(';')[0]!;
  return { session, csrf, token: csrf.slice('nook_csrf='.length) };
}

/**
 * Every organization this run creates, and the ones that deliberately keep a legacy fixture (a CANCELLED invoice without a
 * void record, which predates void records). The last test of the file proves nothing else was left behind.
 */
const createdOrgs = new Set<string>();
const legacyFixtureOrgs = new Set<string>();

async function newOrg(role: 'OWNER' | 'PROPERTY_MANAGER' = 'OWNER'): Promise<Org> {
  const orgId = randomUUID();
  createdOrgs.add(orgId);
  const userId = randomUUID();
  const propertyId = randomUUID();
  const floorId = randomUUID();
  const roomId = randomUUID();
  const email = `fin-${randomUUID()}@nook.test.invalid`;
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1, $2, now())`, [
      orgId,
      `Finance Test Org ${orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Finance Tester',now())`,
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
    await c.query('COMMIT');
  });
  return { orgId, email, userId, propertyId, roomId, cookies: await login(email) };
}

interface SeedOptions {
  price?: string;
  checkInAt?: Date;
  bookingStatus?: 'CONFIRMED' | 'CANCELLED';
  admissionStatus?: 'PENDING' | 'ADMITTED' | 'CANCELLED';
  withCheckIn?: boolean;
  checkedOutAt?: Date;
  bookingStart?: Date;
  bookingEnd?: Date;
  residentStatus?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  name?: string;
}

/** Inserts a resident with booking, admission and check-in directly (fixture seeding). */
async function seedResident(org: Org, opts: SeedOptions = {}) {
  const ids = {
    resident: randomUUID(),
    bed: randomUUID(),
    booking: randomUUID(),
    admission: randomUUID(),
    checkIn: randomUUID(),
  };
  const checkInAt = opts.checkInAt ?? new Date(monthStart.getTime() + 3 * 86_400_000);
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO residents (id, organization_id, first_name, last_name, status, updated_at) VALUES ($1,$2,$3,'Resident',$4,now())`,
      [
        ids.resident,
        org.orgId,
        opts.name ?? `Res${ids.resident.slice(0, 6)}`,
        opts.residentStatus ?? 'ACTIVE',
      ],
    );
    await c.query(
      `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
      [ids.bed, org.orgId, org.propertyId, org.roomId, `B-${ids.bed.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [
        ids.booking,
        org.orgId,
        ids.resident,
        ids.bed,
        opts.bookingStart ?? checkInAt,
        opts.bookingEnd ?? new Date(checkInAt.getTime() + 365 * 86_400_000),
        opts.price ?? '5000.00',
        opts.bookingStatus ?? 'CONFIRMED',
      ],
    );
    await c.query(
      `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
      [
        ids.admission,
        org.orgId,
        ids.booking,
        ids.resident,
        ids.bed,
        checkInAt,
        opts.admissionStatus ?? 'ADMITTED',
      ],
    );
    if (opts.withCheckIn !== false) {
      await c.query(
        `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
        [
          ids.checkIn,
          org.orgId,
          ids.admission,
          ids.resident,
          ids.bed,
          ids.booking,
          checkInAt,
          opts.checkedOutAt ? 'CHECKED_OUT' : 'ACTIVE',
        ],
      );
      if (opts.checkedOutAt) {
        await c.query(
          `INSERT INTO check_outs (id, organization_id, check_in_id, resident_id, bed_id, booking_id, check_out_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
          [
            randomUUID(),
            org.orgId,
            ids.checkIn,
            ids.resident,
            ids.bed,
            ids.booking,
            opts.checkedOutAt,
          ],
        );
      }
    }
    await c.query('COMMIT');
  });
  return ids;
}

function post(org: Org, path: string, body: unknown, headers: Record<string, string> = {}) {
  return server
    .post(`/api/v1${path}`)
    .set('Origin', ORIGIN)
    .set(headers)
    .set('Cookie', `${org.cookies.session}; ${org.cookies.csrf}`)
    .set('x-csrf-token', org.cookies.token)
    .send(body as object);
}
function del(org: Org, path: string) {
  return server
    .delete(`/api/v1${path}`)
    .set('Origin', ORIGIN)
    .set('Cookie', `${org.cookies.session}; ${org.cookies.csrf}`)
    .set('x-csrf-token', org.cookies.token);
}
function get(org: Org, path: string) {
  return server.get(`/api/v1${path}`).set('Cookie', `${org.cookies.session}; ${org.cookies.csrf}`);
}

/**
 * Creates and issues a one-off invoice for a freshly seeded resident whose stay covers `month`.
 * `dueDate === null` simulates a legacy invoice due on the 5th of its month (a direct database
 * update, as an invoice issued today gets the later of the 5th and today).
 */
async function issuedInvoice(
  org: Org,
  price = '100.00',
  dueDate: string | null = future,
  month = monthStr,
) {
  const monthFirst = new Date(`${month}-01T00:00:00Z`);
  const ids = await seedResident(
    org,
    month === monthStr
      ? { price }
      : { price, checkInAt: new Date(monthFirst.getTime() + 86_400_000) },
  );
  const created = await post(org, '/finance/invoices', {
    residentId: ids.resident,
    bookingId: ids.booking,
    month,
    ...(dueDate ? { dueDate } : {}),
  }).expect(201);
  if (dueDate === null) {
    // A legacy invoice due on the 5th of its month. The due date is frozen once issued and the API gives
    // an invoice the later of the 5th and today, so this is issued by SQL in a single DRAFT -> ISSUED update.
    await withMigratorClient((c) =>
      c.query(
        `UPDATE invoices SET status = 'ISSUED', issued_at = now(), due_date = $2 WHERE id = $1`,
        [created.body.id, `${month}-05`],
      ),
    );
  } else {
    await post(org, `/finance/invoices/${created.body.id}/issue`, {}).expect(201);
  }
  return { ids, invoiceId: created.body.id as string };
}

const pay = (
  org: Org,
  invoiceId: string,
  amount: unknown,
  extra: object = {},
  key: string = randomUUID(),
) =>
  post(
    org,
    '/finance/payments',
    { invoiceId, amount, method: 'CASH', ...extra },
    { 'Idempotency-Key': key },
  );

async function count(sql: string, params: unknown[]): Promise<number> {
  return withMigratorClient(async (c) => Number((await c.query(sql, params)).rows[0].n));
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

// ------------------------------------------------------------------ invoices

test('invoice: draft creation snapshots the booking monthlyPrice and numbers sequentially', async () => {
  const org = await newOrg();
  const a = await seedResident(org, { price: '7500.00' });
  const b = await seedResident(org, { price: '6000.00' });
  const first = await post(org, '/finance/invoices', {
    residentId: a.resident,
    bookingId: a.booking,
    month: monthStr,
  }).expect(201);
  const second = await post(org, '/finance/invoices', {
    residentId: b.resident,
    bookingId: b.booking,
    month: monthStr,
  }).expect(201);
  assert.equal(first.body.amount, '7500.00');
  assert.equal(first.body.status, 'DRAFT');
  assert.equal(first.body.paidAmount, '0.00');
  assert.match(first.body.number, /^INV-\d{4}-0001$/);
  assert.match(second.body.number, /^INV-\d{4}-0002$/);

  // Changing the booking price afterwards must not alter the snapshot.
  await withMigratorClient((c) =>
    c.query(`UPDATE bookings SET monthly_price = 9999 WHERE id = $1`, [a.booking]),
  );
  const reread = await get(org, `/finance/invoices/${first.body.id}`).expect(200);
  assert.equal(reread.body.amount, '7500.00');
});

test('invoice: issuing moves DRAFT to ISSUED once; re-issuing conflicts', async () => {
  const org = await newOrg();
  const ids = await seedResident(org);
  const draft = await post(org, '/finance/invoices', {
    residentId: ids.resident,
    bookingId: ids.booking,
    month: monthStr,
  }).expect(201);
  const issued = await post(org, `/finance/invoices/${draft.body.id}/issue`, {}).expect(201);
  assert.equal(issued.body.storedStatus, 'ISSUED');
  assert.ok(issued.body.issuedAt);
  await post(org, `/finance/invoices/${draft.body.id}/issue`, {}).expect(409);
});

test('invoice: manual draft validation', async () => {
  const org = await newOrg();
  const ids = await seedResident(org);
  const draft = (extra: object) =>
    post(org, '/finance/invoices', {
      residentId: ids.resident,
      bookingId: ids.booking,
      month: monthStr,
      ...extra,
    });
  await post(org, '/finance/invoices', { residentId: ids.resident, month: monthStr }).expect(400); // no booking
  await draft({ month: '2026-13' }).expect(400);
  await draft({ dueDate: '2000-01-01' }).expect(400);
  await draft({ residentId: 'nope' }).expect(400);
  await draft({ month: '2099-01' }).expect(400);
  await get(org, '/finance/invoices/not-a-uuid').expect(400);
});

test('invoice: an amount can never be supplied; the booking price is the only source', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, { price: '4200.00' });
  for (const amount of ['10', '10.005', 0, -5, '4200.00', null as unknown as string]) {
    const res = await post(org, '/finance/invoices', {
      residentId: ids.resident,
      bookingId: ids.booking,
      month: monthStr,
      amount,
    }).expect(400);
    assert.match(res.body.message, /amount cannot be set/i);
  }
  // no booking and an amount: still refused, nothing created
  await post(org, '/finance/invoices', {
    residentId: ids.resident,
    month: monthStr,
    amount: '10',
  }).expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM invoices WHERE organization_id = $1`, [org.orgId]),
    0,
  );
  const ok = await post(org, '/finance/invoices', {
    residentId: ids.resident,
    bookingId: ids.booking,
    month: monthStr,
  }).expect(201);
  assert.equal(ok.body.amount, '4200.00');
});

test('invoice: a manual draft outside the booking period or without a stay is refused', async () => {
  const org = await newOrg();
  const endsOnFirst = await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 20 * DAY),
    bookingEnd: monthStart,
  });
  const noStay = await seedResident(org, { withCheckIn: false });
  const body = (r: { resident: string; booking: string }) => ({
    residentId: r.resident,
    bookingId: r.booking,
    month: monthStr,
  });
  const exclusive = await post(org, '/finance/invoices', body(endsOnFirst)).expect(400);
  assert.match(exclusive.body.message, /does not cover/i);
  const nothing = await post(org, '/finance/invoices', body(noStay)).expect(400);
  assert.match(nothing.body.message, /no recorded stay/i);
  // the previous month is covered, exactly up to the exclusive end
  await post(org, '/finance/invoices', { ...body(endsOnFirst), month: prevMonthStr }).expect(201);
});

test('invoice: late move-in is charged the full monthly rent (no proration)', async () => {
  const org = await newOrg();
  const lastDay = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const first = await seedResident(org, {
    price: '6000.50',
    checkInAt: new Date(Date.UTC(Y, M - 1, 1, 9)),
  });
  const late = await seedResident(org, {
    price: '6000.50',
    checkInAt: new Date(Date.UTC(Y, M - 1, Math.min(25, lastDay), 9)),
  });
  const last = await seedResident(org, {
    price: '6000.50',
    checkInAt: new Date(Date.UTC(Y, M - 1, lastDay, 9)),
  });
  const res = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    dueDate: future,
  }).expect(201);
  assert.equal(res.body.created, 3);
  for (const invoice of res.body.invoices) {
    assert.equal(invoice.amount, '6000.50', 'every move-in day pays the same full rent');
  }
  assert.deepEqual(
    new Set(res.body.invoices.map((i: any) => i.residentId)),
    new Set([first.resident, late.resident, last.resident]),
  );
});

test('invoice: monthly generation creates sequential numbers and can issue immediately', async () => {
  const org = await newOrg();
  await Promise.all([seedResident(org), seedResident(org), seedResident(org)]);
  const res = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    dueDate: future,
    issue: true,
  }).expect(201);
  assert.equal(res.body.created, 3);
  const seqs = res.body.invoices.map((i: any) => Number(i.number.slice(-4))).sort();
  assert.deepEqual(seqs, [1, 2, 3]);
  assert.ok(res.body.invoices.every((i: any) => i.storedStatus === 'ISSUED' && i.issuedAt));
});

test('invoice: duplicate prevention at API and database level', async () => {
  const org = await newOrg();
  const ids = await seedResident(org);
  await post(org, '/finance/invoices', {
    residentId: ids.resident,
    bookingId: ids.booking,
    month: monthStr,
  }).expect(201);
  await post(org, '/finance/invoices', {
    residentId: ids.resident,
    bookingId: ids.booking,
    month: monthStr,
  }).expect(409);

  await assert.rejects(
    withMigratorClient((c) =>
      c.query(
        `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, updated_at)
         VALUES ($1,$2,$3,$4,'INV-2099-9999',$5,$5,10,$5,now())`,
        // a plain date string: a JS Date would be serialised in the process time zone
        [randomUUID(), org.orgId, ids.resident, ids.booking, `${monthStr}-01`],
      ),
    ),
    (e: any) => e.code === '23505' && e.constraint === 'invoices_active_booking_period_key',
    'database unique index must reject a second active invoice for the same org/booking/period',
  );
});

test('invoice: generation is idempotent', async () => {
  const org = await newOrg();
  await Promise.all([seedResident(org), seedResident(org)]);
  const one = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    dueDate: future,
  }).expect(201);
  const two = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    dueDate: future,
  }).expect(201);
  assert.equal(one.body.created, 2);
  assert.equal(two.body.created, 0);
  assert.equal(two.body.skippedExisting, 2);
  assert.equal(
    await count(`SELECT count(*) n FROM invoices WHERE organization_id = $1`, [org.orgId]),
    2,
  );
});

test('invoice: concurrent generation never duplicates and keeps numbers unique and gap-free', async () => {
  const org = await newOrg();
  const residents = 8;
  await Promise.all(Array.from({ length: residents }, () => seedResident(org)));
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      post(org, '/finance/invoices/generate-monthly', { month: monthStr, dueDate: future }),
    ),
  );
  assert.ok(
    results.every((r) => r.status === 201),
    JSON.stringify(results.map((r) => r.status)),
  );
  assert.equal(
    results.reduce((sum, r) => sum + r.body.created, 0),
    residents,
  );
  const rows = await withMigratorClient((c) =>
    c.query(`SELECT number, resident_id FROM invoices WHERE organization_id = $1 ORDER BY number`, [
      org.orgId,
    ]),
  );
  assert.equal(rows.rowCount, residents);
  assert.equal(new Set(rows.rows.map((r) => r.resident_id)).size, residents);
  assert.deepEqual(
    rows.rows.map((r) => Number(r.number.slice(-4))),
    Array.from({ length: residents }, (_, i) => i + 1),
  );
});

test('invoice: concurrent manual drafts get distinct sequential numbers', async () => {
  const org = await newOrg();
  const seeded = await Promise.all(Array.from({ length: 6 }, () => seedResident(org)));
  const results = await Promise.all(
    seeded.map((s) =>
      post(org, '/finance/invoices', {
        residentId: s.resident,
        bookingId: s.booking,
        month: monthStr,
      }),
    ),
  );
  assert.ok(results.every((r) => r.status === 201));
  const numbers = results.map((r) => Number(r.body.number.slice(-4))).sort((a, b) => a - b);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6]);
});

test('invoice: only residents with a billable stay are included in generation', async () => {
  const org = await newOrg();
  const eligible = await seedResident(org);
  await seedResident(org, { bookingStatus: 'CANCELLED', withCheckIn: false }); // cancelled before any check-in
  await seedResident(org, { admissionStatus: 'PENDING', withCheckIn: false });
  await seedResident(org, { withCheckIn: false });
  await seedResident(org, {
    checkedOutAt: new Date(monthStart.getTime() - 86_400_000),
    checkInAt: new Date(monthStart.getTime() - 40 * 86_400_000),
  });
  const res = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    dueDate: future,
  }).expect(201);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.invoices[0].residentId, eligible.resident);
});

test('invoice: a resident who checks out mid-month is still billed the full month', async () => {
  const org = await newOrg();
  const mid = await seedResident(org, {
    price: '4000.00',
    checkInAt: new Date(monthStart.getTime() - 60 * 86_400_000),
    checkedOutAt: new Date(monthStart.getTime() + 2 * 86_400_000),
  });
  const res = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    dueDate: future,
  }).expect(201);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.invoices[0].residentId, mid.resident);
  assert.equal(res.body.invoices[0].amount, '4000.00');
});

test('billing rules: first month is charged in full for a move-in on the last day of the month', async () => {
  const org = await newOrg();
  const lastDay = new Date(Date.UTC(Y, M, 0, 6, 0, 0)); // 11:30 IST on the last day
  const late = await seedResident(org, { price: '9000.00', checkInAt: lastDay });
  const res = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    dueDate: future,
  }).expect(201);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.invoices[0].residentId, late.resident);
  assert.equal(res.body.invoices[0].amount, '9000.00', 'no daily proration');
});

test('billing rules: final month is charged in full whenever the checkout falls inside it', async () => {
  const org = await newOrg();
  const firstDay = await seedResident(org, {
    price: '5000.00',
    checkInAt: new Date(monthStart.getTime() - 90 * 86_400_000),
    checkedOutAt: new Date(monthStart.getTime() + 3_600_000), // 06:30 IST on day 1
  });
  const lastDay = await seedResident(org, {
    price: '6000.00',
    checkInAt: new Date(monthStart.getTime() - 90 * 86_400_000),
    checkedOutAt: new Date(Date.UTC(Y, M, 0, 12, 0, 0)),
  });
  // Midnight IST on day 1 is 18:30 UTC the day before: a checkout in that half hour is day 1 IST.
  const istBoundary = await seedResident(org, {
    price: '7000.00',
    checkInAt: new Date(monthStart.getTime() - 90 * 86_400_000),
    checkedOutAt: new Date(monthStart.getTime() - 5 * 3_600_000),
  });
  const res = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    dueDate: future,
  }).expect(201);
  const byResident = new Map<string, string>(
    res.body.invoices.map((i: any) => [i.residentId, i.amount]),
  );
  assert.equal(byResident.get(firstDay.resident), '5000.00');
  assert.equal(byResident.get(lastDay.resident), '6000.00');
  assert.equal(byResident.get(istBoundary.resident), '7000.00');
  assert.equal(res.body.created, 3);
});

test('billing rules: a checkout completed before the period began is not billed', async () => {
  const org = await newOrg();
  await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 90 * 86_400_000),
    checkedOutAt: new Date(monthStart.getTime() - 8 * 3_600_000), // 22:30 IST the day before
  });
  const res = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    dueDate: future,
  }).expect(201);
  assert.equal(res.body.created, 0);
});

test('billing rules: a status-only CHECKED_OUT check-in (no checkout row) is still billed for its final month', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, {
    price: '4500.00',
    checkInAt: new Date(monthStart.getTime() - 90 * 86_400_000),
  });
  await withMigratorClient((c) =>
    c.query(`UPDATE check_ins SET status = 'CHECKED_OUT', updated_at = now() WHERE id = $1`, [
      ids.checkIn,
    ]),
  );
  const res = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    dueDate: future,
  }).expect(201);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.invoices[0].amount, '4500.00');
});

test('billing rules: invoice numbers use the Asia/Kolkata year', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const row = await withMigratorClient((c) =>
    c.query(`SELECT number FROM invoices WHERE id = $1`, [invoiceId]),
  );
  const istYear = new Date(Date.now() + 330 * 60_000).getUTCFullYear();
  assert.match(row.rows[0].number, new RegExp(`^INV-${istYear}-\\d{4,}$`));
});

// ------------------------------------------------------------------ payments

test('payment: full payment marks the invoice PAID', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const res = await pay(org, invoiceId, '100.00').expect(201);
  assert.equal(res.body.invoice.status, 'PAID');
  assert.equal(res.body.invoice.balance, '0.00');
  assert.equal(res.body.payment.receiptNumber, `RCPT-${res.body.payment.id}`);
  await pay(org, invoiceId, '0.01').expect(400); // already fully paid
});

test('payment: partial payments accumulate and the exact remainder settles the invoice', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '1000.30');
  const p1 = await pay(org, invoiceId, '0.10').expect(201);
  assert.equal(p1.body.invoice.status, 'PARTIALLY_PAID');
  assert.equal(p1.body.invoice.balance, '1000.20');
  const p2 = await pay(org, invoiceId, '0.20').expect(201);
  assert.equal(p2.body.invoice.paidAmount, '0.30', 'no 0.1 + 0.2 float drift');
  assert.equal(p2.body.invoice.balance, '1000.00');
  const p3 = await pay(org, invoiceId, '1000.00').expect(201);
  assert.equal(p3.body.invoice.status, 'PAID');
  assert.equal(p3.body.invoice.paidAmount, '1000.30');
  const detail = await get(org, `/finance/invoices/${invoiceId}`).expect(200);
  assert.equal(detail.body.payments.length, 3);
  const sum = await withMigratorClient((c) =>
    c.query(`SELECT COALESCE(SUM(amount),0)::text s FROM payments WHERE invoice_id = $1`, [
      invoiceId,
    ]),
  );
  assert.equal(sum.rows[0].s, '1000.30', 'stored paid_amount equals the sum of payment rows');
});

test('payment: overpayment is rejected with 400 and changes nothing', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  await pay(org, invoiceId, '60.00').expect(201);
  const res = await pay(org, invoiceId, '40.01').expect(400);
  assert.match(res.body.message, /remaining balance/);
  const detail = await get(org, `/finance/invoices/${invoiceId}`).expect(200);
  assert.equal(detail.body.paidAmount, '60.00');
  assert.equal(detail.body.payments.length, 1);
  await pay(org, invoiceId, '40.00').expect(201); // exact remainder still works
});

test('payment: zero, negative and malformed amounts are rejected', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  for (const bad of ['0', 0, '0.00', '-1', -50, '1.005', 'abc', '', null, '1e2']) {
    await pay(org, invoiceId, bad).expect(400);
  }
  await pay(org, invoiceId, '10', { method: 'CARD' }).expect(400);
  await pay(org, invoiceId, '10', {
    receivedAt: new Date(Date.now() + 86_400_000 * 5).toISOString(),
  }).expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    0,
  );
});

test('payment: draft and cancelled invoices cannot be paid', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, { price: '100.00' });
  const draft = await post(org, '/finance/invoices', {
    residentId: ids.resident,
    bookingId: ids.booking,
    month: monthStr,
  }).expect(201);
  await pay(org, draft.body.id, '10').expect(400);
  // CANCELLED is reachable only through a void record (the database refuses a bare status update)
  await post(org, `/finance/invoices/${draft.body.id}/void`, { reason: 'Created in error' }).expect(
    201,
  );
  const res = await pay(org, draft.body.id, '10').expect(400);
  assert.match(res.body.message, /cancelled/i);
});

test('payment: concurrent payments never overpay the invoice', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const results = await Promise.all(Array.from({ length: 10 }, () => pay(org, invoiceId, '30.00')));
  const ok = results.filter((r) => r.status === 201).length;
  const rejected = results.filter((r) => r.status === 400).length;
  assert.equal(ok, 3, JSON.stringify(results.map((r) => r.status)));
  assert.equal(rejected, 7);
  const row = await withMigratorClient((c) =>
    c.query(`SELECT paid_amount::text p, status FROM invoices WHERE id = $1`, [invoiceId]),
  );
  assert.equal(row.rows[0].p, '90.00');
  assert.equal(row.rows[0].status, 'PARTIALLY_PAID');
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    3,
  );
});

test('payment: two concurrent exact-remainder payments settle exactly once', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '250.00');
  const results = await Promise.all([pay(org, invoiceId, '250.00'), pay(org, invoiceId, '250.00')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
  const row = await withMigratorClient((c) =>
    c.query(`SELECT paid_amount::text p, status FROM invoices WHERE id = $1`, [invoiceId]),
  );
  assert.equal(row.rows[0].p, '250.00');
  assert.equal(row.rows[0].status, 'PAID');
});

test('payment: a failure after the payment insert rolls the whole transaction back', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const fn = `fin_test_fail_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  assertFaultInjectionName(fn); // only a per-run, test-owned name may be created or dropped
  await withMigratorClient(async (c) => {
    await c.query(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
      IF NEW.action = 'finance.payment.recorded' AND NEW.organization_id = '${org.orgId}' THEN RAISE EXCEPTION 'forced failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await c.query(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
  });
  try {
    await pay(org, invoiceId, '40.00').expect(500);
    const row = await withMigratorClient((c) =>
      c.query(`SELECT paid_amount::text p, status FROM invoices WHERE id = $1`, [invoiceId]),
    );
    assert.equal(row.rows[0].p, '0.00', 'invoice balance untouched');
    assert.equal(row.rows[0].status, 'ISSUED');
    assert.equal(
      await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
      0,
      'payment row rolled back',
    );
  } finally {
    await withMigratorClient(async (c) => {
      await c.query(`DROP TRIGGER IF EXISTS ${fn} ON audit_events`);
      await c.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    });
  }
  await pay(org, invoiceId, '40.00').expect(201); // healthy again
});

// ------------------------------------------------------------ payment idempotency

test('idempotency: a repeated identical request returns the original result and records one payment', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const key = `retry-${randomUUID()}`;
  const first = await pay(org, invoiceId, '40.00', { reference: 'UTR1' }, key).expect(201);
  const second = await pay(org, invoiceId, '40.00', { reference: 'UTR1' }, key).expect(201);
  assert.equal(first.body.idempotentReplay, false);
  assert.equal(second.body.idempotentReplay, true);
  assert.equal(second.body.payment.id, first.body.payment.id);
  assert.deepEqual(second.body.invoice, first.body.invoice, 'replay returns the original snapshot');
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    1,
  );
  const row = await withMigratorClient((c) =>
    c.query(`SELECT paid_amount::text p FROM invoices WHERE id = $1`, [invoiceId]),
  );
  assert.equal(row.rows[0].p, '40.00', 'the retry must not be applied twice');
  assert.equal(
    await count(
      `SELECT count(*) n FROM audit_events WHERE organization_id = $1 AND action = 'finance.payment.recorded'`,
      [org.orgId],
    ),
    1,
  );
});

test('idempotency: a replay still succeeds after the invoice is fully paid or changed', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const key = `settle-${randomUUID()}`;
  const first = await pay(org, invoiceId, '100.00', {}, key).expect(201);
  // A fresh payment would now fail ("already fully paid"); the replay must not.
  const replay = await pay(org, invoiceId, '100.00', {}, key).expect(201);
  assert.equal(replay.body.payment.id, first.body.payment.id);
  await pay(org, invoiceId, '1.00').expect(400);
});

test('idempotency: the same key with a different payload is rejected with 409 and changes nothing', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const key = `reuse-${randomUUID()}`;
  await pay(org, invoiceId, '40.00', {}, key).expect(201);
  await pay(org, invoiceId, '41.00', {}, key).expect(409);
  await pay(org, invoiceId, '40.00', { method: 'UPI' }, key).expect(409);
  await pay(org, invoiceId, '40.00', { reference: 'other' }, key).expect(409);
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    1,
  );
  const other = await issuedInvoice(org, '100.00');
  await pay(org, other.invoiceId, '40.00', {}, key).expect(409);
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [other.invoiceId]),
    0,
  );
});

test('idempotency: concurrent identical requests create exactly one payment', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const key = `race-${randomUUID()}`;
  const results = await Promise.all(
    Array.from({ length: 12 }, () => pay(org, invoiceId, '25.00', { reference: 'R' }, key)),
  );
  assert.deepEqual(
    [...new Set(results.map((r) => r.status))],
    [201],
    JSON.stringify(results.map((r) => r.status)),
  );
  assert.equal(new Set(results.map((r) => r.body.payment.id)).size, 1, 'one payment id for all');
  assert.equal(results.filter((r) => r.body.idempotentReplay === false).length, 1);
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    1,
  );
  assert.equal(
    await count(`SELECT count(*) n FROM payment_idempotency_keys WHERE organization_id = $1`, [
      org.orgId,
    ]),
    1,
  );
  const row = await withMigratorClient((c) =>
    c.query(`SELECT paid_amount::text p FROM invoices WHERE id = $1`, [invoiceId]),
  );
  assert.equal(row.rows[0].p, '25.00');
});

test('idempotency: concurrent same-key requests with different payloads yield one winner and 409s', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const key = `race-mix-${randomUUID()}`;
  const results = await Promise.all(
    [10, 20, 30, 40].map((n) => pay(org, invoiceId, `${n}.00`, {}, key)),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 3);
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    1,
  );
});

test('idempotency: a failed transaction stores no key, so a retry with the same key succeeds once', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const key = `failed-${randomUUID()}`;
  const fn = `fin_test_idem_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  assertFaultInjectionName(fn); // only a per-run, test-owned name may be created or dropped
  await withMigratorClient(async (c) => {
    await c.query(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
      IF NEW.action = 'finance.payment.recorded' AND NEW.organization_id = '${org.orgId}' THEN RAISE EXCEPTION 'forced failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await c.query(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
  });
  try {
    await pay(org, invoiceId, '40.00', {}, key).expect(500);
    assert.equal(
      await count(`SELECT count(*) n FROM payment_idempotency_keys WHERE organization_id = $1`, [
        org.orgId,
      ]),
      0,
    );
    assert.equal(
      await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
      0,
    );
  } finally {
    await withMigratorClient(async (c) => {
      await c.query(`DROP TRIGGER IF EXISTS ${fn} ON audit_events`);
      await c.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    });
  }
  const retry = await pay(org, invoiceId, '40.00', {}, key).expect(201);
  assert.equal(retry.body.idempotentReplay, false);
  const again = await pay(org, invoiceId, '40.00', {}, key).expect(201);
  assert.equal(again.body.payment.id, retry.body.payment.id);
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    1,
  );
});

test('idempotency: a rejected payment (overpayment) does not consume the key', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const key = `over-${randomUUID()}`;
  await pay(org, invoiceId, '150.00', {}, key).expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM payment_idempotency_keys WHERE organization_id = $1`, [
      org.orgId,
    ]),
    0,
  );
  await pay(org, invoiceId, '100.00', {}, key).expect(201);
});

test('idempotency: different organizations may use the same key independently', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await issuedInvoice(orgA, '100.00');
  const b = await issuedInvoice(orgB, '100.00');
  const key = `shared-${randomUUID()}`;
  const [ra, rb] = await Promise.all([
    pay(orgA, a.invoiceId, '30.00', {}, key),
    pay(orgB, b.invoiceId, '30.00', {}, key),
  ]);
  assert.equal(ra.status, 201);
  assert.equal(rb.status, 201);
  assert.notEqual(ra.body.payment.id, rb.body.payment.id);
  assert.equal(ra.body.idempotentReplay, false);
  assert.equal(rb.body.idempotentReplay, false);
  // Org B cannot reach org A's invoice, and a replay never crosses the organization boundary.
  await pay(orgB, a.invoiceId, '30.00', {}, `probe-${randomUUID()}`).expect(404);
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [a.invoiceId]),
    1,
  );
});

test('idempotency: the key is required and validated', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const body = { invoiceId, amount: '10.00', method: 'CASH' };
  await post(org, '/finance/payments', body).expect(400);
  for (const bad of ['short', 'has space in it!', 'x'.repeat(129)]) {
    await post(org, '/finance/payments', body, { 'Idempotency-Key': bad }).expect(400);
  }
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    0,
  );
});

test('idempotency: keys are append-only and bound to a payment of the same organization', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await issuedInvoice(orgA, '100.00');
  const paid = await pay(orgA, a.invoiceId, '10.00').expect(201);
  await withMigratorClient(async (c) => {
    await assert.rejects(
      c.query(
        `UPDATE payment_idempotency_keys SET request_hash = repeat('a',64) WHERE payment_id = $1`,
        [paid.body.payment.id],
      ),
      /append-only/,
    );
    await assert.rejects(
      c.query(`DELETE FROM payment_idempotency_keys WHERE payment_id = $1`, [paid.body.payment.id]),
      /append-only/,
    );
  });
  // A key-less payment (inserted directly as the owner) lets the composite FK fire before the unique index on payment_id
  // could. It is a probe: it runs in a transaction that is rolled back, so it never leaves a payment the invoice does not
  // know about (which would be ledger drift).
  await rolledBack(async (c) => {
    const bare = await c.query(
      `INSERT INTO payments (organization_id, invoice_id, resident_id, amount, method, received_at, updated_at)
       SELECT organization_id, id, resident_id, 1, 'CASH', now(), now() FROM invoices WHERE id = $1 RETURNING id`,
      [a.invoiceId],
    );
    await assert.rejects(
      c.query(
        `INSERT INTO payment_idempotency_keys (organization_id, key, request_hash, payment_id, response) VALUES ($1,'cross-org-key-1',repeat('a',64),$2,'{}')`,
        [orgB.orgId, bare.rows[0].id],
      ),
      /foreign key/,
    );
  });
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [a.invoiceId]),
    1,
  );
});

// ------------------------------------------------------------ financial corrections

// "Reason omitted" and "reason explicitly undefined" must be distinguishable, so no default parameter.
const reverse = (org: Org, paymentId: string, ...reason: [unknown?]) =>
  post(org, `/finance/payments/${paymentId}/reverse`, {
    reason: reason.length ? reason[0] : 'Entered against the wrong invoice',
  });
const credit = (org: Org, invoiceId: string, amount: unknown, ...reason: [unknown?]) =>
  post(org, `/finance/invoices/${invoiceId}/adjustments`, {
    amount,
    reason: reason.length ? reason[0] : 'Goodwill discount',
  });
const invoiceRow = (id: string) =>
  withMigratorClient(
    async (c) =>
      (
        await c.query(
          `SELECT amount::text a, paid_amount::text p, adjustment_total::text adj, status FROM invoices WHERE id = $1`,
          [id],
        )
      ).rows[0],
  );
/** paid_amount must always equal live (non-reversed) payments plus applied credits. */
async function assertLedgerInvariant(invoiceId: string) {
  const row = await withMigratorClient(
    async (c) =>
      (
        await c.query(
          `SELECT i.paid_amount::text p,
                (COALESCE((SELECT sum(p.amount) FROM payments p
                           WHERE p.invoice_id = i.id
                             AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)), 0)
                 - COALESCE((SELECT sum(a.amount) FROM invoice_adjustments a WHERE a.invoice_id = i.id), 0))::text expected,
                i.adjustment_total::text adj,
                COALESCE((SELECT sum(a.amount) FROM invoice_adjustments a WHERE a.invoice_id = i.id), 0)::text adj_expected
         FROM invoices i WHERE i.id = $1`,
          [invoiceId],
        )
      ).rows[0],
  );
  assert.equal(
    row.p,
    Number(row.expected).toFixed(2),
    'paid_amount equals payments - reversals - credits',
  );
  assert.equal(
    row.adj,
    Number(row.adj_expected).toFixed(2),
    'adjustment_total equals the credit records',
  );
}

test('reversal: reduces the paid amount, restores the balance and keeps the payment row untouched', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const paid = await pay(org, invoiceId, '40.00', { reference: 'UTR-9' }).expect(201);
  const before = await withMigratorClient(
    async (c) =>
      (await c.query(`SELECT * FROM payments WHERE id = $1`, [paid.body.payment.id])).rows[0],
  );
  const res = await reverse(org, paid.body.payment.id).expect(201);
  assert.equal(res.body.invoice.paidAmount, '0.00');
  assert.equal(res.body.invoice.balance, '100.00');
  assert.equal(res.body.invoice.status, 'ISSUED');
  assert.equal(res.body.reversal.reason, 'Entered against the wrong invoice');
  assert.equal(res.body.payment.reversed, true);
  const after = await withMigratorClient(
    async (c) =>
      (await c.query(`SELECT * FROM payments WHERE id = $1`, [paid.body.payment.id])).rows[0],
  );
  assert.deepEqual(after, before, 'the original payment row is byte-for-byte unchanged');
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    1,
  );
  assert.equal(
    await count(`SELECT count(*) n FROM payment_idempotency_keys WHERE payment_id = $1`, [
      paid.body.payment.id,
    ]),
    1,
    'the original idempotency record is preserved',
  );
  await assertLedgerInvariant(invoiceId);
});

test('reversal: a PAID invoice drops back to PARTIALLY_PAID or ISSUED', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const first = await pay(org, invoiceId, '60.00').expect(201);
  const second = await pay(org, invoiceId, '40.00').expect(201);
  assert.equal((await invoiceRow(invoiceId)).status, 'PAID');
  const r1 = await reverse(org, second.body.payment.id).expect(201);
  assert.equal(r1.body.invoice.status, 'PARTIALLY_PAID');
  assert.equal(r1.body.invoice.balance, '40.00');
  const r2 = await reverse(org, first.body.payment.id).expect(201);
  assert.equal(r2.body.invoice.status, 'ISSUED');
  assert.equal(r2.body.invoice.balance, '100.00');
  await assertLedgerInvariant(invoiceId);
});

test('reversal: a reason is required and a payment can be reversed only once', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const paid = await pay(org, invoiceId, '40.00').expect(201);
  for (const bad of [undefined, '', '   ', 'ab', 'x'.repeat(501), 123, null]) {
    await reverse(org, paid.body.payment.id, bad).expect(400);
  }
  assert.equal(
    await count(`SELECT count(*) n FROM payment_reversals WHERE organization_id = $1`, [org.orgId]),
    0,
  );
  await reverse(org, paid.body.payment.id).expect(201);
  await reverse(org, paid.body.payment.id).expect(409);
  assert.equal(
    await count(`SELECT count(*) n FROM payment_reversals WHERE organization_id = $1`, [org.orgId]),
    1,
  );
  assert.equal(
    (await invoiceRow(invoiceId)).p,
    '0.00',
    'the second attempt did not subtract again',
  );
});

test('reversal: concurrent requests reverse the payment exactly once', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const keep = await pay(org, invoiceId, '30.00').expect(201);
  const target = await pay(org, invoiceId, '50.00').expect(201);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => reverse(org, target.body.payment.id)),
  );
  assert.equal(
    results.filter((r) => r.status === 201).length,
    1,
    JSON.stringify(results.map((r) => r.status)),
  );
  assert.equal(results.filter((r) => r.status === 409).length, 9);
  const row = await invoiceRow(invoiceId);
  assert.equal(row.p, '30.00', 'only the reversed 50.00 was removed, once');
  assert.equal(row.status, 'PARTIALLY_PAID');
  await assertLedgerInvariant(invoiceId);
  void keep;
});

test('reversal and a new payment racing on the same invoice never corrupt the balance', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const first = await pay(org, invoiceId, '100.00').expect(201);
  // The invoice is PAID: a new payment can only succeed once the reversal has freed the balance.
  const [rev, again] = await Promise.all([
    reverse(org, first.body.payment.id),
    pay(org, invoiceId, '100.00'),
  ]);
  assert.equal(rev.status, 201);
  assert.ok([201, 400].includes(again.status), String(again.status));
  const row = await invoiceRow(invoiceId);
  assert.ok(Number(row.p) >= 0 && Number(row.p) <= 100);
  await assertLedgerInvariant(invoiceId);
});

test('correction: reverse, then record a replacement payment linked to it with a new key', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const wrong = await pay(org, invoiceId, '40.00', { method: 'CASH' }).expect(201);
  // A replacement before the reversal is refused.
  await pay(org, invoiceId, '45.00', { correctsPaymentId: wrong.body.payment.id }).expect(400);
  await reverse(org, wrong.body.payment.id).expect(201);
  const key = `replace-${randomUUID()}`;
  const fixed = await pay(
    org,
    invoiceId,
    '45.00',
    { method: 'UPI', correctsPaymentId: wrong.body.payment.id },
    key,
  ).expect(201);
  assert.equal(fixed.body.payment.correctsPaymentId, wrong.body.payment.id);
  assert.notEqual(fixed.body.payment.id, wrong.body.payment.id);
  const row = await invoiceRow(invoiceId);
  assert.equal(row.p, '45.00');
  assert.equal(row.status, 'PARTIALLY_PAID');
  // The replacement is itself idempotent, and the same payment cannot be replaced twice.
  const replay = await pay(
    org,
    invoiceId,
    '45.00',
    { method: 'UPI', correctsPaymentId: wrong.body.payment.id },
    key,
  ).expect(201);
  assert.equal(replay.body.idempotentReplay, true);
  await pay(org, invoiceId, '5.00', { correctsPaymentId: wrong.body.payment.id }).expect(409);
  await assertLedgerInvariant(invoiceId);
  // Both rows survive, linked, in the invoice history.
  const detail = await get(org, `/finance/invoices/${invoiceId}`).expect(200);
  assert.equal(detail.body.payments.length, 2);
  assert.equal(
    detail.body.payments.find((p: any) => p.id === wrong.body.payment.id).reversed,
    true,
  );
});

test('correction: a payment from a different invoice or organization cannot be corrected', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a1 = await issuedInvoice(orgA, '100.00');
  const a2 = await issuedInvoice(orgA, '100.00');
  const pa = await pay(orgA, a1.invoiceId, '10.00').expect(201);
  await reverse(orgA, pa.body.payment.id).expect(201);
  await pay(orgA, a2.invoiceId, '10.00', { correctsPaymentId: pa.body.payment.id }).expect(404);
  const b = await issuedInvoice(orgB, '100.00');
  await pay(orgB, b.invoiceId, '10.00', { correctsPaymentId: pa.body.payment.id }).expect(404);
});

test('correction: the database itself refuses a replacement for a payment that was not reversed', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const paid = await pay(org, invoiceId, '10.00').expect(201);
  await withMigratorClient(async (c) => {
    await assert.rejects(
      c.query(
        `INSERT INTO payments (organization_id, invoice_id, resident_id, amount, method, received_at, updated_at, corrects_payment_id)
         SELECT organization_id, id, resident_id, 5, 'CASH', now(), now(), $2 FROM invoices WHERE id = $1`,
        [invoiceId, paid.body.payment.id],
      ),
      /only correct a reversed payment/,
    );
  });
});

test('adjustment: a credit lowers the balance, keeps the issued amount and is recorded append-only', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '1000.00');
  const res = await credit(org, invoiceId, '-150.50', 'Hot water outage rebate').expect(201);
  assert.equal(res.body.invoice.amount, '1000.00', 'issued amount is never overwritten');
  assert.equal(res.body.invoice.balance, '849.50');
  assert.equal(res.body.invoice.adjustmentTotal, '-150.50');
  assert.equal(res.body.invoice.cashReceived, '0.00');
  assert.equal(res.body.invoice.status, 'ISSUED');
  assert.equal(res.body.adjustment.amount, '-150.50');
  assert.equal(res.body.adjustment.reason, 'Hot water outage rebate');
  await assertLedgerInvariant(invoiceId);
  await pay(org, invoiceId, '849.51').expect(400); // the credited balance is the new ceiling
  const settled = await pay(org, invoiceId, '849.50').expect(201);
  assert.equal(settled.body.invoice.status, 'PAID');
  assert.equal(settled.body.invoice.cashReceived, '849.50');
  assert.equal((await invoiceRow(invoiceId)).a, '1000.00');
  await assertLedgerInvariant(invoiceId);
});

test('adjustment: validation - credits only, reason required, never beyond the balance', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  for (const bad of [
    '50',
    '50.00',
    '+50',
    '0',
    '-0',
    '-0.00',
    '-1.234',
    '-abc',
    '',
    null,
    undefined,
    {},
    '-1e2',
  ]) {
    await credit(org, invoiceId, bad).expect(400);
  }
  for (const bad of [undefined, '', '  ', 'ab', 'x'.repeat(501)]) {
    await credit(org, invoiceId, '-10.00', bad).expect(400);
  }
  await credit(org, invoiceId, '-100.01').expect(400);
  assert.equal(
    await count(`SELECT count(*) n FROM invoice_adjustments WHERE invoice_id = $1`, [invoiceId]),
    0,
  );
  await pay(org, invoiceId, '40.00').expect(201);
  await credit(org, invoiceId, '-60.01').expect(400);
  await credit(org, invoiceId, '-60.00').expect(201); // exactly the balance: settles the invoice
  const row = await invoiceRow(invoiceId);
  assert.equal(row.status, 'PAID');
  assert.equal(row.p, '100.00');
  assert.equal(row.adj, '-60.00');
  await credit(org, invoiceId, '-1.00').expect(400); // nothing left to credit
  await assertLedgerInvariant(invoiceId);
});

test('adjustment: draft and unknown invoices are refused', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, { price: '100.00' });
  const draft = await post(org, '/finance/invoices', {
    residentId: ids.resident,
    bookingId: ids.booking,
    month: monthStr,
  }).expect(201);
  await credit(org, draft.body.id, '-10.00').expect(400);
  await credit(org, randomUUID(), '-10.00').expect(404);
  await credit(org, 'not-a-uuid', '-10.00').expect(400);
});

test('adjustment: concurrent credits can never exceed the balance', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const results = await Promise.all(
    Array.from({ length: 8 }, () => credit(org, invoiceId, '-30.00')),
  );
  assert.equal(
    results.filter((r) => r.status === 201).length,
    3,
    JSON.stringify(results.map((r) => r.status)),
  );
  assert.equal(results.filter((r) => r.status === 400).length, 5);
  const row = await invoiceRow(invoiceId);
  assert.equal(row.p, '90.00');
  assert.equal(row.adj, '-90.00');
  await assertLedgerInvariant(invoiceId);
});

test('adjustment and reversal compose: balances stay consistent through a mixed sequence', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '1000.00');
  const p1 = await pay(org, invoiceId, '300.00').expect(201);
  await credit(org, invoiceId, '-200.00').expect(201); // settled 500, cash 300
  assert.equal((await invoiceRow(invoiceId)).status, 'PARTIALLY_PAID');
  const rev = await reverse(org, p1.body.payment.id).expect(201); // settled 200, cash 0
  assert.equal(rev.body.invoice.paidAmount, '200.00');
  assert.equal(rev.body.invoice.cashReceived, '0.00');
  assert.equal(rev.body.invoice.balance, '800.00');
  assert.equal(rev.body.invoice.status, 'ISSUED', 'no cash held after the reversal');
  await pay(org, invoiceId, '800.00').expect(201);
  assert.equal((await invoiceRow(invoiceId)).status, 'PAID');
  await assertLedgerInvariant(invoiceId);
});

test('audit: reversals and credits write one in-transaction audit event with before/after balances', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const paid = await pay(org, invoiceId, '40.00').expect(201);
  await reverse(org, paid.body.payment.id, 'Duplicate entry').expect(201);
  await credit(org, invoiceId, '-25.00', 'Early move-out concession').expect(201);
  const rows = await withMigratorClient(
    async (c) =>
      (
        await c.query(
          `SELECT action, target_type, target_id, actor_user_id, metadata FROM audit_events
         WHERE organization_id = $1 AND action IN ('finance.payment.reversed','finance.invoice.adjusted') ORDER BY occurred_at`,
          [org.orgId],
        )
      ).rows,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].action, 'finance.payment.reversed');
  assert.equal(rows[0].target_id, paid.body.payment.id);
  assert.equal(rows[0].actor_user_id, org.userId);
  assert.equal(rows[0].metadata.reason, 'Duplicate entry');
  assert.equal(rows[0].metadata.balanceBefore, '60.00');
  assert.equal(rows[0].metadata.balanceAfter, '100.00');
  assert.equal(rows[0].metadata.statusBefore, 'PARTIALLY_PAID');
  assert.equal(rows[0].metadata.statusAfter, 'ISSUED');
  assert.equal(rows[1].action, 'finance.invoice.adjusted');
  assert.equal(rows[1].metadata.balanceBefore, '100.00');
  assert.equal(rows[1].metadata.balanceAfter, '75.00');
  assert.equal(rows[1].metadata.amount, '-25.00');
  const serialized = JSON.stringify(rows);
  assert.ok(
    !/UTR|reference/i.test(serialized),
    'no payment reference is copied into the audit trail',
  );
});

test('corrections: a failure after the reversal insert rolls everything back', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const paid = await pay(org, invoiceId, '40.00').expect(201);
  const fn = `fin_test_rev_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  assertFaultInjectionName(fn); // only a per-run, test-owned name may be created or dropped
  await withMigratorClient(async (c) => {
    await c.query(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
      IF NEW.action IN ('finance.payment.reversed','finance.invoice.adjusted') AND NEW.organization_id = '${org.orgId}' THEN RAISE EXCEPTION 'forced failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await c.query(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
  });
  try {
    await reverse(org, paid.body.payment.id).expect(500);
    await credit(org, invoiceId, '-10.00').expect(500);
    const row = await invoiceRow(invoiceId);
    assert.equal(row.p, '40.00', 'balance untouched');
    assert.equal(row.adj, '0.00');
    assert.equal(
      await count(`SELECT count(*) n FROM payment_reversals WHERE organization_id = $1`, [
        org.orgId,
      ]),
      0,
    );
    assert.equal(
      await count(`SELECT count(*) n FROM invoice_adjustments WHERE organization_id = $1`, [
        org.orgId,
      ]),
      0,
    );
  } finally {
    await withMigratorClient(async (c) => {
      await c.query(`DROP TRIGGER IF EXISTS ${fn} ON audit_events`);
      await c.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    });
  }
  await reverse(org, paid.body.payment.id).expect(201); // healthy again, and not "already reversed"
});

test('corrections: history rows are append-only and tenant-bound at the database level', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await issuedInvoice(orgA, '100.00');
  const paid = await pay(orgA, a.invoiceId, '40.00').expect(201);
  await reverse(orgA, paid.body.payment.id).expect(201);
  await credit(orgA, a.invoiceId, '-10.00').expect(201);
  await withMigratorClient(async (c) => {
    await assert.rejects(
      c.query(`UPDATE payment_reversals SET reason = 'edited reason' WHERE organization_id = $1`, [
        orgA.orgId,
      ]),
      /append-only/,
    );
    await assert.rejects(
      c.query(`DELETE FROM payment_reversals WHERE organization_id = $1`, [orgA.orgId]),
      /append-only/,
    );
    await assert.rejects(
      c.query(`UPDATE invoice_adjustments SET amount = -1 WHERE organization_id = $1`, [
        orgA.orgId,
      ]),
      /append-only/,
    );
    await assert.rejects(
      c.query(`DELETE FROM invoice_adjustments WHERE organization_id = $1`, [orgA.orgId]),
      /append-only/,
    );
    await assert.rejects(
      c.query(`UPDATE payments SET amount = 1 WHERE id = $1`, [paid.body.payment.id]),
      /immutable/,
    );
    // A reversal / adjustment pointing at another organization's payment or invoice is impossible.
    const b = await issuedInvoice(orgB, '100.00');
    const pb = await pay(orgB, b.invoiceId, '10.00').expect(201);
    await assert.rejects(
      c.query(
        `INSERT INTO payment_reversals (organization_id, payment_id, invoice_id, reason, reversed_by) VALUES ($1,$2,$3,'cross tenant',$4)`,
        [orgA.orgId, pb.body.payment.id, b.invoiceId, orgA.userId],
      ),
      /foreign key/,
    );
    await assert.rejects(
      c.query(
        `INSERT INTO invoice_adjustments (organization_id, invoice_id, resident_id, amount, reason, created_by)
         SELECT $1, id, resident_id, -1, 'cross tenant', $3 FROM invoices WHERE id = $2`,
        [orgA.orgId, b.invoiceId, orgA.userId],
      ),
      /foreign key/,
    );
    // Credits only, and cash received can never go negative.
    await assert.rejects(
      c.query(
        `INSERT INTO invoice_adjustments (organization_id, invoice_id, resident_id, amount, reason, created_by)
         SELECT organization_id, id, resident_id, 5, 'positive', $2 FROM invoices WHERE id = $1`,
        [a.invoiceId, orgA.userId],
      ),
      /credit_only/,
    );
    await assert.rejects(
      c.query(`UPDATE invoices SET paid_amount = 0, adjustment_total = -20 WHERE id = $1`, [
        a.invoiceId,
      ]),
      /cash_received_non_negative/,
    );
  });
});

test('corrections: cross-organization reversal, credit and history access is blocked', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await issuedInvoice(orgA, '100.00');
  const paid = await pay(orgA, a.invoiceId, '40.00').expect(201);
  await reverse(orgB, paid.body.payment.id).expect(404);
  await credit(orgB, a.invoiceId, '-10.00').expect(404);
  await get(orgB, `/finance/corrections?invoiceId=${a.invoiceId}`)
    .expect(200)
    .then((r) => assert.equal(r.body.items.length, 0));
  assert.equal((await invoiceRow(a.invoiceId)).p, '40.00');
  assert.equal(
    await count(`SELECT count(*) n FROM payment_reversals WHERE organization_id = $1`, [
      orgA.orgId,
    ]),
    0,
  );
  // A client-supplied organizationId is ignored.
  await post(orgB, `/finance/payments/${paid.body.payment.id}/reverse`, {
    reason: 'spoof attempt',
    organizationId: orgA.orgId,
  }).expect(404);
});

test('corrections: both OWNER and PROPERTY_MANAGER may reverse, credit and read history', async () => {
  const org = await newOrg('PROPERTY_MANAGER');
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const paid = await pay(org, invoiceId, '40.00').expect(201);
  await reverse(org, paid.body.payment.id).expect(201);
  await credit(org, invoiceId, '-10.00').expect(201);
  const history = await get(org, `/finance/corrections`).expect(200);
  assert.equal(history.body.items.length, 2);
});

test('corrections: history lists reversals and credits newest first with actor and reason', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const paid = await pay(org, invoiceId, '40.00').expect(201);
  await reverse(org, paid.body.payment.id, 'Wrong resident').expect(201);
  await credit(org, invoiceId, '-5.00', 'Late fee waiver').expect(201);
  const history = await get(org, `/finance/corrections`).expect(200);
  assert.deepEqual(
    history.body.items.map((i: any) => i.type),
    ['INVOICE_CREDIT', 'PAYMENT_REVERSAL'],
  );
  assert.equal(history.body.items[0].reason, 'Late fee waiver');
  assert.equal(history.body.items[0].amount, '-5.00');
  assert.equal(history.body.items[1].reason, 'Wrong resident');
  assert.equal(history.body.items[1].invoiceId, invoiceId);
  assert.equal(history.body.items[1].actor, 'Finance Tester');
  const scoped = await get(org, `/finance/corrections?invoiceId=${invoiceId}`).expect(200);
  assert.equal(scoped.body.items.length, 2);
});

test('reports and receipts: a reversed payment leaves collections and its receipt is marked reversed', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const keep = await pay(org, invoiceId, '30.00').expect(201);
  const gone = await pay(org, invoiceId, '20.00').expect(201);
  const before = await get(org, `/finance/reports/monthly?month=${monthStr}`).expect(200);
  assert.equal(before.body.months.at(-1).collected, '50.00');
  await reverse(org, gone.body.payment.id).expect(201);
  const after = await get(org, `/finance/reports/monthly?month=${monthStr}`).expect(200);
  assert.equal(after.body.months.at(-1).collected, '30.00');
  assert.equal(after.body.months.at(-1).outstanding, '70.00');
  const receipt = await get(org, `/finance/invoices/${invoiceId}/receipt`).expect(200);
  const byId = new Map<string, any>(receipt.body.receipts.map((r: any) => [r.paymentId, r]));
  assert.equal(byId.get(gone.body.payment.id).reversed, true);
  assert.equal(byId.get(keep.body.payment.id).reversed, false);
  assert.equal(byId.get(keep.body.payment.id).balanceAfterPayment, '70.00');
});

test('security: correction endpoints reject unauthenticated and CSRF-less writes', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const paid = await pay(org, invoiceId, '40.00').expect(201);
  const id = paid.body.payment.id;
  assert.equal((await server.get('/api/v1/finance/corrections')).status, 401);
  assert.equal(
    (
      await server
        .post(`/api/v1/finance/payments/${id}/reverse`)
        .set('Origin', ORIGIN)
        .send({ reason: 'abc' })
    ).status,
    401,
  );
  assert.equal(
    (
      await server
        .post(`/api/v1/finance/invoices/${invoiceId}/adjustments`)
        .set('Origin', ORIGIN)
        .send({ amount: '-1', reason: 'abc' })
    ).status,
    401,
  );
  const cookie = `${org.cookies.session}; ${org.cookies.csrf}`;
  const noCsrf = await server
    .post(`/api/v1/finance/payments/${id}/reverse`)
    .set('Origin', ORIGIN)
    .set('Cookie', cookie)
    .send({ reason: 'no csrf token' });
  assert.equal(noCsrf.status, 403);
  const badOrigin = await server
    .post(`/api/v1/finance/invoices/${invoiceId}/adjustments`)
    .set('Origin', 'https://evil.example')
    .set('Cookie', cookie)
    .set('x-csrf-token', org.cookies.token)
    .send({ amount: '-1', reason: 'evil origin' });
  assert.equal(badOrigin.status, 403);
  assert.equal((await invoiceRow(invoiceId)).p, '40.00');
});

// ------------------------------------------------------------------ receipts

test('receipt: numbers are deterministic from the payment id and unique', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const p1 = await pay(org, invoiceId, '30.00').expect(201);
  const p2 = await pay(org, invoiceId, '30.00').expect(201);
  const all = await get(org, `/finance/invoices/${invoiceId}/receipt`).expect(200);
  assert.equal(all.body.receipts.length, 2);
  const numbers = all.body.receipts.map((r: any) => r.receiptNumber);
  assert.equal(new Set(numbers).size, 2);
  assert.deepEqual(numbers, [`RCPT-${p1.body.payment.id}`, `RCPT-${p2.body.payment.id}`]);
  assert.deepEqual(
    all.body.receipts.map((r: any) => r.balanceAfterPayment),
    ['70.00', '40.00'],
  );
  const again = await get(org, `/finance/invoices/${invoiceId}/receipt`).expect(200);
  assert.deepEqual(
    again.body.receipts.map((r: any) => r.receiptNumber),
    numbers,
    'stable across requests',
  );

  const one = await get(
    org,
    `/finance/invoices/${invoiceId}/receipt?paymentId=${p2.body.payment.id}`,
  ).expect(200);
  assert.equal(one.body.receipts.length, 1);
  assert.equal(one.body.receipts[0].receiptNumber, `RCPT-${p2.body.payment.id}`);
  await get(org, `/finance/invoices/${invoiceId}/receipt?paymentId=${randomUUID()}`).expect(404);
  await get(org, `/finance/invoices/${invoiceId}/receipt?paymentId=bad`).expect(400);

  const unpaid = await issuedInvoice(org, '50.00');
  await get(org, `/finance/invoices/${unpaid.invoiceId}/receipt`).expect(404);
});

// ------------------------------------------------------- history is append-only

test('history: payments are immutable and invoices cannot be deleted or re-priced once issued', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const paid = await pay(org, invoiceId, '25.00').expect(201);
  const paymentId = paid.body.payment.id;
  const rejects = (sql: string, params: unknown[]) =>
    assert.rejects(
      withMigratorClient((c) => c.query(sql, params)),
      (e: any) => e.code === '23001',
    );

  await rejects(`UPDATE payments SET amount = 1 WHERE id = $1`, [paymentId]);
  await rejects(`DELETE FROM payments WHERE id = $1`, [paymentId]);
  await rejects(`DELETE FROM invoices WHERE id = $1`, [invoiceId]);
  await rejects(`UPDATE invoices SET amount = 1 WHERE id = $1`, [invoiceId]);
  await assert.rejects(
    withMigratorClient((c) =>
      c.query(`UPDATE invoices SET paid_amount = 500 WHERE id = $1`, [invoiceId]),
    ),
    (e: any) => e.code === '23514',
    'paid amount can never exceed the invoice amount',
  );
  const detail = await get(org, `/finance/invoices/${invoiceId}`).expect(200);
  assert.equal(detail.body.amount, '100.00');
  assert.equal(detail.body.paidAmount, '25.00');
});

test('history: payments cannot reference another organization or a mismatched resident', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const { invoiceId } = await issuedInvoice(orgA, '100.00');
  const foreignResident = await seedResident(orgB);
  await assert.rejects(
    withMigratorClient((c) =>
      c.query(
        `INSERT INTO payments (id, organization_id, invoice_id, resident_id, amount, method, received_at, updated_at)
         VALUES ($1,$2,$3,$4,10,'CASH',now(),now())`,
        [randomUUID(), orgB.orgId, invoiceId, foreignResident.resident],
      ),
    ),
    (e: any) => e.code === '23503',
    'composite FK must stop cross-tenant payments',
  );
});

// ------------------------------------------------------ outstanding & reports

test('outstanding and monthly report reflect balances, overdue and collections', async () => {
  const org = await newOrg();
  const open = await issuedInvoice(org, '1000.00', future);
  const overdue = await issuedInvoice(org, '500.00', null, prevMonthStr); // due on the 5th of last month
  const paid = await issuedInvoice(org, '200.00', future);
  await pay(org, open.invoiceId, '400.00').expect(201);
  await pay(org, overdue.invoiceId, '100.00').expect(201);
  await pay(org, paid.invoiceId, '200.00').expect(201);

  const out = await get(org, '/finance/outstanding').expect(200);
  assert.equal(out.body.totals.outstandingAmount, '1000.00'); // 600 + 400
  assert.equal(out.body.totals.overdueAmount, '400.00');
  assert.equal(out.body.totals.outstandingCount, 2);
  assert.equal(out.body.items[0].id, overdue.invoiceId, 'oldest due date first');
  assert.equal(out.body.items[0].status, 'OVERDUE');
  assert.ok(out.body.items[0].daysOverdue > 0);
  const onlyOverdue = await get(org, '/finance/outstanding?overdueOnly=true').expect(200);
  assert.equal(onlyOverdue.body.items.length, 1);

  const report = await get(org, `/finance/reports/monthly?month=${monthStr}&months=3`).expect(200);
  assert.equal(report.body.months.length, 3);
  const current = report.body.months.at(-1);
  assert.equal(current.month, monthStr);
  assert.equal(current.invoiced, '1200.00');
  assert.equal(
    current.collected,
    '700.00',
    'collections are by received date, across invoice periods',
  );
  assert.equal(current.outstanding, '600.00');
  assert.equal(current.overdue, '0.00');
  assert.equal(current.invoiceCount, 2);
  const previous = report.body.months.at(-2);
  assert.equal(previous.month, prevMonthStr);
  assert.equal(previous.invoiced, '500.00');
  assert.equal(previous.outstanding, '400.00');
  assert.equal(previous.overdue, '400.00');

  const overdueList = await get(org, '/finance/invoices?status=OVERDUE').expect(200);
  assert.deepEqual(
    overdueList.body.items.map((i: any) => i.id),
    [overdue.invoiceId],
  );
  const paidList = await get(org, '/finance/invoices?status=PAID').expect(200);
  assert.deepEqual(
    paidList.body.items.map((i: any) => i.id),
    [paid.invoiceId],
  );
  await get(org, '/finance/invoices?status=BOGUS').expect(400);
  await get(org, '/finance/invoices?limit=1000').expect(400);
  const page = await get(org, '/finance/invoices?limit=2&page=2').expect(200);
  assert.equal(page.body.total, 3);
  assert.equal(page.body.items.length, 1);
});

// ------------------------------------------------------------------ security

test('security: every endpoint rejects unauthenticated requests', async () => {
  const id = randomUUID();
  const calls = [
    server.get('/api/v1/finance/invoices'),
    server.get(`/api/v1/finance/invoices/${id}`),
    server.get(`/api/v1/finance/invoices/${id}/receipt`),
    server.get('/api/v1/finance/outstanding'),
    server.get('/api/v1/finance/reports/monthly'),
    server.post('/api/v1/finance/invoices').set('Origin', ORIGIN).send({}),
    server.post('/api/v1/finance/invoices/generate-monthly').set('Origin', ORIGIN).send({}),
    server.post(`/api/v1/finance/invoices/${id}/issue`).set('Origin', ORIGIN).send({}),
    server.post('/api/v1/finance/payments').set('Origin', ORIGIN).send({}),
  ];
  for (const response of await Promise.all(calls)) assert.equal(response.status, 401);
});

test('security: writes require a matching Origin and CSRF token', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const cookie = `${org.cookies.session}; ${org.cookies.csrf}`;
  const noCsrf = await server
    .post('/api/v1/finance/payments')
    .set('Origin', ORIGIN)
    .set('Cookie', cookie)
    .send({ invoiceId, amount: '10', method: 'CASH' });
  assert.equal(noCsrf.status, 403);
  const badOrigin = await server
    .post('/api/v1/finance/payments')
    .set('Origin', 'https://evil.example')
    .set('Cookie', cookie)
    .set('x-csrf-token', org.cookies.token)
    .send({ invoiceId, amount: '10', method: 'CASH' });
  assert.equal(badOrigin.status, 403);
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    0,
  );
});

test('security: cross-organization invoice, payment and receipt access is blocked', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await issuedInvoice(orgA, '100.00');
  const paid = await pay(orgA, a.invoiceId, '20.00').expect(201);

  await get(orgB, `/finance/invoices/${a.invoiceId}`).expect(404);
  await get(orgB, `/finance/invoices/${a.invoiceId}/receipt`).expect(404);
  await get(
    orgB,
    `/finance/invoices/${a.invoiceId}/receipt?paymentId=${paid.body.payment.id}`,
  ).expect(404);
  await post(orgB, `/finance/invoices/${a.invoiceId}/issue`, {}).expect(404);
  await pay(orgB, a.invoiceId, '10.00').expect(404);

  const list = await get(orgB, '/finance/invoices').expect(200);
  assert.equal(list.body.total, 0);
  const out = await get(orgB, '/finance/outstanding').expect(200);
  assert.equal(out.body.totals.outstandingAmount, '0.00');
  const report = await get(orgB, `/finance/reports/monthly?month=${monthStr}`).expect(200);
  assert.equal(report.body.months[0].invoiced, '0.00');
  assert.equal(report.body.months[0].collected, '0.00');

  const untouched = await get(orgA, `/finance/invoices/${a.invoiceId}`).expect(200);
  assert.equal(untouched.body.paidAmount, '20.00');
});

test('security: a client-supplied organizationId is ignored', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await issuedInvoice(orgA, '100.00');
  const residentA = await seedResident(orgA, { price: '300.00' });
  const residentB = await seedResident(orgB, { price: '300.00' });

  // B creates a draft for A's resident while claiming to be A: must not leak or create anything in A.
  await post(orgB, '/finance/invoices', {
    organizationId: orgA.orgId,
    residentId: residentA.resident,
    bookingId: residentA.booking,
    month: monthStr,
  }).expect(404);
  // B pays A's invoice while claiming to be A.
  await pay(orgB, a.invoiceId, '10.00', { organizationId: orgA.orgId }).expect(404);
  // B's own draft with a spoofed organizationId lands in B, not A.
  const own = await post(orgB, '/finance/invoices', {
    organizationId: orgA.orgId,
    residentId: residentB.resident,
    bookingId: residentB.booking,
    month: monthStr,
  }).expect(201);
  const row = await withMigratorClient((c) =>
    c.query(`SELECT organization_id FROM invoices WHERE id = $1`, [own.body.id]),
  );
  assert.equal(row.rows[0].organization_id, orgB.orgId);
  // Query-string spoofing on reads.
  const list = await get(orgB, `/finance/invoices?organizationId=${orgA.orgId}`).expect(200);
  assert.ok(list.body.items.every((i: any) => i.id !== a.invoiceId));
  assert.equal(
    await count(`SELECT count(*) n FROM invoices WHERE organization_id = $1`, [orgA.orgId]),
    1,
  );
});

test('security: PROPERTY_MANAGER can work with finance; a revoked membership cannot', async () => {
  const manager = await newOrg('PROPERTY_MANAGER');
  const { invoiceId } = await issuedInvoice(manager, '100.00');
  await pay(manager, invoiceId, '10.00').expect(201);
  await get(manager, '/finance/outstanding').expect(200);

  await withMigratorClient((c) =>
    c.query(
      `UPDATE memberships SET status = 'REVOKED', revoked_at = now() WHERE organization_id = $1`,
      [manager.orgId],
    ),
  );
  const denied = await get(manager, '/finance/invoices');
  assert.ok([401, 403].includes(denied.status), `revoked membership got ${denied.status}`);
  const deniedWrite = await pay(manager, invoiceId, '10.00');
  assert.ok(
    [401, 403].includes(deniedWrite.status),
    `revoked membership write got ${deniedWrite.status}`,
  );
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    1,
  );
});

// ------------------------------------------------ 4F.1 correctness regressions

const istYmd = (instant: Date) =>
  new Date(instant.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const generate = (org: Org, month: string, extra: object = {}) =>
  post(org, '/finance/invoices/generate-monthly', { month, ...extra });
const nextMonthStart = new Date(Date.UTC(Y, M, 1));
const nextMonthStr = nextMonthStart.toISOString().slice(0, 7);
const billedResidents = (res: any) =>
  new Set<string>(res.body.invoices.map((i: any) => i.residentId));

test('eligibility: a booking ending on the 1st does not bill that month, but bills the month before', async () => {
  const org = await newOrg();
  const stay = await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 20 * DAY),
    bookingEnd: monthStart, // exclusive end: the 1st is the first day the bed is no longer booked
  });
  assert.equal(
    billedResidents(await generate(org, monthStr).expect(201)).has(stay.resident),
    false,
  );
  assert.equal(
    billedResidents(await generate(org, prevMonthStr).expect(201)).has(stay.resident),
    true,
  );
});

test('eligibility: booking end instants are compared as Asia/Kolkata calendar dates', async () => {
  const org = await newOrg();
  const istMidnightOfFirst = new Date(monthStart.getTime() - 330 * 60_000);
  const mk = (bookingEnd: Date) =>
    seedResident(org, { checkInAt: new Date(monthStart.getTime() - 20 * DAY), bookingEnd });
  const endsFirstAtIstMidnight = await mk(istMidnightOfFirst);
  const endsFirstLate = await mk(new Date(istMidnightOfFirst.getTime() + 23 * 3_600_000));
  const endsSecond = await mk(new Date(istMidnightOfFirst.getTime() + DAY));
  const billed = billedResidents(await generate(org, monthStr).expect(201));
  assert.equal(billed.has(endsFirstAtIstMidnight.resident), false);
  assert.equal(billed.has(endsFirstLate.resident), false, 'any time on the end date is not billed');
  assert.equal(
    billed.has(endsSecond.resident),
    true,
    'the 1st is occupied when the end is the 2nd',
  );
});

test('eligibility: a future-dated booking is not billed before it starts', async () => {
  const org = await newOrg();
  const stay = await seedResident(org, {
    bookingStart: nextMonthStart,
    bookingEnd: new Date(nextMonthStart.getTime() + 90 * DAY),
  });
  assert.equal(
    billedResidents(await generate(org, monthStr).expect(201)).has(stay.resident),
    false,
  );
  assert.equal(
    billedResidents(await generate(org, nextMonthStr).expect(201)).has(stay.resident),
    true,
  );
});

test('eligibility: cancelling after check-out keeps occupied months billable; cancelling before check-in bills nothing', async () => {
  const org = await newOrg();
  const base = { checkInAt: new Date(monthStart.getTime() - 20 * DAY) };
  const normal = await seedResident(org, {
    ...base,
    checkedOutAt: new Date(monthStart.getTime() + 2 * DAY),
  });
  const cancelledAfter = await seedResident(org, {
    ...base,
    checkedOutAt: new Date(monthStart.getTime() + 2 * DAY),
    bookingStatus: 'CANCELLED',
    admissionStatus: 'CANCELLED',
  });
  const cancelledBefore = await seedResident(org, {
    bookingStatus: 'CANCELLED',
    admissionStatus: 'CANCELLED',
    withCheckIn: false,
  });
  const billed = billedResidents(await generate(org, monthStr).expect(201));
  assert.equal(billed.has(normal.resident), true);
  assert.equal(
    billed.has(cancelledAfter.resident),
    true,
    'a cancelled booking keeps its price and stay',
  );
  assert.equal(billed.has(cancelledBefore.resident), false);
  const row = await withMigratorClient((c) =>
    c.query(`SELECT amount::text a FROM invoices WHERE resident_id = $1`, [
      cancelledAfter.resident,
    ]),
  );
  assert.equal(row.rows[0].a, '5000.00');
});

test('eligibility: an early check-out stops billing for later months', async () => {
  const org = await newOrg();
  const left = await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 40 * DAY),
    checkedOutAt: new Date(monthStart.getTime() - 3 * DAY),
  });
  assert.equal(
    billedResidents(await generate(org, monthStr).expect(201)).has(left.resident),
    false,
  );
});

test('eligibility: an issued invoice is not changed or duplicated by a later cancellation or regeneration', async () => {
  const org = await newOrg();
  const stay = await seedResident(org, { price: '3300.00' });
  const first = await generate(org, monthStr, { issue: true }).expect(201);
  assert.equal(first.body.created, 1);
  const read = () =>
    withMigratorClient((c) =>
      c.query(`SELECT * FROM invoices WHERE resident_id = $1`, [stay.resident]),
    ).then((r) => JSON.stringify(r.rows));
  const before = await read();
  await withMigratorClient((c) =>
    c.query(`UPDATE bookings SET status = 'CANCELLED', monthly_price = 1 WHERE id = $1`, [
      stay.booking,
    ]),
  );
  const again = await generate(org, monthStr, { issue: true }).expect(201);
  assert.equal(again.body.created, 0);
  assert.equal(await read(), before);
});

test('eligibility: no outstanding balance is carried into a new invoice', async () => {
  const org = await newOrg();
  const stay = await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 20 * DAY),
    price: '2500.00',
  });
  const prev = await generate(org, prevMonthStr, { issue: true }).expect(201);
  assert.equal(prev.body.invoices[0].balance, '2500.00', 'left unpaid');
  const current = await generate(org, monthStr).expect(201);
  const invoice = current.body.invoices.find((i: any) => i.residentId === stay.resident);
  assert.equal(invoice.amount, '2500.00');
  assert.equal(invoice.balance, '2500.00');
});

test('extension: only an approved extension makes a month past the original end billable', async () => {
  const org = await newOrg();
  const stay = await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 20 * DAY),
    bookingEnd: monthStart, // ended on the 1st, resident is still checked in
  });
  assert.equal(
    billedResidents(await generate(org, monthStr).expect(201)).has(stay.resident),
    false,
  );
  await post(org, `/bookings/${stay.booking}/extend`, {
    newEndDate: nextMonthStart.toISOString().slice(0, 10),
    reason: 'Resident stayed on with the owner approval',
  }).expect(201);
  assert.equal(billedResidents(await generate(org, monthStr).expect(201)).has(stay.resident), true);
});

test('due date: an invoice issued through the API is due the later of the 5th and the issue date (IST)', async () => {
  const org = await newOrg();
  const ids = await seedResident(org);
  const draft = await post(org, '/finance/invoices', {
    residentId: ids.resident,
    bookingId: ids.booking,
    month: monthStr,
  }).expect(201);
  assert.equal(draft.body.dueDate, `${monthStr}-05`, 'a draft keeps the provisional 5th');
  const issued = await post(org, `/finance/invoices/${draft.body.id}/issue`, {}).expect(201);
  const today = istYmd(new Date(issued.body.issuedAt));
  const fifth = `${monthStr}-05`;
  assert.equal(issued.body.dueDate, today > fifth ? today : fifth);
  assert.notEqual(issued.body.status, 'OVERDUE', 'never born overdue');
});

test('due date: automatically issued invoices follow the same rule and the date never moves afterwards', async () => {
  const org = await newOrg();
  await seedResident(org);
  const res = await generate(org, monthStr, { issue: true }).expect(201);
  const [inv] = res.body.invoices;
  const today = istYmd(new Date(inv.issuedAt));
  assert.equal(inv.dueDate, today > `${monthStr}-05` ? today : `${monthStr}-05`);
  const reread = await get(org, `/finance/invoices/${inv.id}`).expect(200);
  assert.equal(reread.body.dueDate, inv.dueDate);
});

test('audit: every automatically issued invoice has exactly one issued event, and a retry adds none', async () => {
  const org = await newOrg();
  for (let i = 0; i < 4; i += 1) await seedResident(org);
  const events = () =>
    count(
      `SELECT count(*) n FROM audit_events WHERE organization_id = $1 AND action = 'finance.invoice.issued'`,
      [org.orgId],
    );
  const res = await generate(org, monthStr, { issue: true }).expect(201);
  assert.equal(res.body.created, 4);
  assert.equal(await events(), 4);
  assert.equal(
    await count(
      `SELECT count(DISTINCT target_id) n FROM audit_events WHERE organization_id = $1 AND action = 'finance.invoice.issued'`,
      [org.orgId],
    ),
    4,
    'one per invoice',
  );
  assert.equal(
    await count(
      `SELECT count(*) n FROM audit_events WHERE organization_id = $1 AND action = 'finance.invoices.generated'`,
      [org.orgId],
    ),
    1,
  );
  const meta = await withMigratorClient((c) =>
    c.query(
      `SELECT actor_user_id, metadata FROM audit_events WHERE organization_id = $1 AND action = 'finance.invoice.issued' LIMIT 1`,
      [org.orgId],
    ),
  );
  assert.equal(meta.rows[0].actor_user_id, org.userId);
  assert.equal(meta.rows[0].metadata.automatic, true);
  assert.equal(meta.rows[0].metadata.source, 'generate-monthly');

  const retry = await generate(org, monthStr, { issue: true }).expect(201);
  assert.equal(retry.body.created, 0);
  assert.equal(await events(), 4, 'a retry creates no further events');
  // concurrent duplicate runs still yield one event per invoice
  const org2 = await newOrg();
  for (let i = 0; i < 3; i += 1) await seedResident(org2);
  await Promise.all([1, 2, 3].map(() => generate(org2, monthStr, { issue: true })));
  assert.equal(
    await count(
      `SELECT count(*) n FROM audit_events WHERE organization_id = $1 AND action = 'finance.invoice.issued'`,
      [org2.orgId],
    ),
    3,
  );
});

test('time: a zone-less receivedAt is Asia/Kolkata, and monthly reports use Asia/Kolkata months', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '1000.00', future);
  const ppStart = new Date(Date.UTC(Y, M - 3, 1));
  const ppStr = ppStart.toISOString().slice(0, 7);
  const ppLastDay = new Date(Date.UTC(Y, M - 2, 0)).getUTCDate();
  // 00:30 IST on the 1st of last month belongs to last month (it is still the previous day in UTC)
  const first = await pay(org, invoiceId, '100.00', {
    receivedAt: `${prevMonthStr}-01T00:30`,
  }).expect(201);
  assert.equal(
    first.body.payment.receivedAt,
    new Date(`${prevMonthStr}-01T00:30:00+05:30`).toISOString(),
  );
  // 23:30 IST on the last day of the month before that belongs to that month
  const second = await pay(org, invoiceId, '50.00', {
    receivedAt: `${ppStr}-${ppLastDay}T23:30`,
  }).expect(201);
  assert.equal(
    second.body.payment.receivedAt,
    new Date(`${ppStr}-${ppLastDay}T23:30:00+05:30`).toISOString(),
  );
  // an explicit offset is respected as given
  const third = await pay(org, invoiceId, '25.00', {
    receivedAt: `${prevMonthStr}-10T12:00:00Z`,
  }).expect(201);
  assert.equal(third.body.payment.receivedAt, `${prevMonthStr}-10T12:00:00.000Z`);

  const report = await get(org, `/finance/reports/monthly?month=${prevMonthStr}&months=2`).expect(
    200,
  );
  const byMonth = Object.fromEntries(report.body.months.map((m: any) => [m.month, m]));
  assert.equal(byMonth[ppStr].collected, '50.00');
  assert.equal(byMonth[prevMonthStr].collected, '125.00');
  assert.equal(byMonth[prevMonthStr].paymentCount, 2);
});

// ------------------------------------- resident status never erases a historical stay

test('resident status: INACTIVE and ARCHIVED residents with a valid stay are still billed', async () => {
  const org = await newOrg();
  const base = { checkInAt: new Date(monthStart.getTime() - 20 * DAY) };
  const active = await seedResident(org, { ...base });
  const inactive = await seedResident(org, { ...base, residentStatus: 'INACTIVE' });
  const archived = await seedResident(org, { ...base, residentStatus: 'ARCHIVED' });
  const billed = billedResidents(await generate(org, monthStr).expect(201));
  for (const r of [active, inactive, archived]) assert.equal(billed.has(r.resident), true);
});

test('resident status: changing it after check-out does not erase the months that were occupied', async () => {
  const org = await newOrg();
  const left = await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 40 * DAY),
    checkedOutAt: new Date(monthStart.getTime() + 2 * DAY),
    price: '3100.00',
  });
  // the resident is archived after leaving, before the month is ever invoiced
  await withMigratorClient((c) =>
    c.query(`UPDATE residents SET status = 'ARCHIVED' WHERE id = $1`, [left.resident]),
  );
  const res = await generate(org, monthStr).expect(201);
  const invoice = res.body.invoices.find((i: any) => i.residentId === left.resident);
  assert.ok(invoice, 'the occupied month is still invoiced');
  assert.equal(invoice.amount, '3100.00');
  // a manual draft for the same stay follows the same rule
  const other = await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 40 * DAY),
    checkedOutAt: new Date(monthStart.getTime() + 2 * DAY),
    residentStatus: 'INACTIVE',
  });
  await post(org, '/finance/invoices', {
    residentId: other.resident,
    bookingId: other.booking,
    month: monthStr,
  }).expect(201);
});

test('resident status: an inactive resident is not billed outside the booking dates or after check-out', async () => {
  const org = await newOrg();
  const left = await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 60 * DAY),
    checkedOutAt: new Date(monthStart.getTime() - 3 * DAY),
    residentStatus: 'INACTIVE',
  });
  const ended = await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 20 * DAY),
    bookingEnd: monthStart,
    residentStatus: 'INACTIVE',
  });
  const future = await seedResident(org, {
    bookingStart: nextMonthStart,
    bookingEnd: new Date(nextMonthStart.getTime() + 90 * DAY),
    residentStatus: 'ARCHIVED',
  });
  const billed = billedResidents(await generate(org, monthStr).expect(201));
  assert.equal(billed.has(left.resident), false, 'checked out before the month');
  assert.equal(billed.has(ended.resident), false, 'booking ended on the 1st (exclusive)');
  assert.equal(billed.has(future.resident), false, 'booking has not started');
});

test('resident status: an inactive resident follows approved extensions and keeps existing invoices', async () => {
  const org = await newOrg();
  const stay = await seedResident(org, {
    checkInAt: new Date(monthStart.getTime() - 20 * DAY),
    bookingEnd: monthStart,
    residentStatus: 'INACTIVE',
  });
  // the previous month was invoiced earlier and stays as it is
  const prev = await generate(org, prevMonthStr, { issue: true }).expect(201);
  const prevInvoice = prev.body.invoices.find((i: any) => i.residentId === stay.resident);
  assert.ok(prevInvoice);
  assert.equal(
    billedResidents(await generate(org, monthStr).expect(201)).has(stay.resident),
    false,
  );
  await post(org, `/bookings/${stay.booking}/extend`, {
    newEndDate: nextMonthStart.toISOString().slice(0, 10),
    reason: 'Stayed on while marked inactive',
  }).expect(201);
  const after = await generate(org, monthStr).expect(201);
  assert.equal(billedResidents(after).has(stay.resident), true);
  const reread = await get(org, `/finance/invoices/${prevInvoice.id}`).expect(200);
  assert.equal(reread.body.amount, prevInvoice.amount);
  assert.equal(reread.body.storedStatus, 'ISSUED');
  assert.equal(
    await count(`SELECT count(*) n FROM invoices WHERE resident_id = $1`, [stay.resident]),
    2,
    'one invoice per billed month, none duplicated',
  );
});

test('resident: DELETE archives a resident with invoices and payments and removes none of that history', async () => {
  const org = await newOrg();
  const { ids, invoiceId } = await issuedInvoice(org, '1500.00', future);
  await pay(org, invoiceId, '500.00').expect(201);
  // a resident who is checked in cannot be archived; the stay has to end first
  await del(org, `/residents/${ids.resident}`).expect(409);
  const [stay] = await sqlRows(`SELECT id FROM check_ins WHERE resident_id = $1`, [ids.resident]);
  await post(org, `/check-ins/${stay.id}/check-out`, {
    checkOutAt: new Date(monthStart.getTime() + 10 * DAY).toISOString(),
  }).expect(201);
  const archived = await del(org, `/residents/${ids.resident}`).expect(200);
  assert.equal(archived.body.status, 'ARCHIVED');
  const rows = await withMigratorClient((c) =>
    c.query(
      `SELECT (SELECT count(*)::int FROM residents WHERE id = $1) r,
              (SELECT count(*)::int FROM bookings WHERE resident_id = $1) b,
              (SELECT count(*)::int FROM admissions WHERE resident_id = $1) a,
              (SELECT count(*)::int FROM check_ins WHERE resident_id = $1) ci,
              (SELECT count(*)::int FROM invoices WHERE resident_id = $1) i,
              (SELECT count(*)::int FROM payments WHERE resident_id = $1) p`,
      [ids.resident],
    ),
  );
  assert.deepEqual(rows.rows[0], { r: 1, b: 1, a: 1, ci: 1, i: 1, p: 1 });
  const invoice = await get(org, `/finance/invoices/${invoiceId}`).expect(200);
  assert.equal(invoice.body.paidAmount, '500.00');
  assert.equal(invoice.body.balance, '1000.00');
  // the stay ended this month, so next month is not billed; archiving changed nothing about what was billed
  const next = await generate(org, nextMonthStr).expect(201);
  assert.equal(billedResidents(next).has(ids.resident), false);
  assert.equal((await invoiceRow(invoiceId)).p, '500.00');
});

// ============================================================ 4F.2 ledger integrity

const voidReq = (org: Org, invoiceId: string, reason: unknown = 'Issued to the wrong resident') =>
  post(org, `/finance/invoices/${invoiceId}/void`, { reason });
const sqlRows = (query: string, params: unknown[] = []) =>
  withMigratorClient(async (c) => (await c.query(query, params)).rows);
const refused = (query: string, params: unknown[], code: string) =>
  assert.rejects(
    withMigratorClient((c) => c.query(query, params)),
    (e: any) => e.code === code,
    `expected SQLSTATE ${code} for: ${query.slice(0, 70)}`,
  );
const draftFor = async (org: Org, price = '800.00') => {
  const ids = await seedResident(org, { price });
  const draft = await post(org, '/finance/invoices', {
    residentId: ids.resident,
    bookingId: ids.booking,
    month: monthStr,
  }).expect(201);
  return { ids, id: draft.body.id as string };
};
const paymentRows = (invoiceId: string) =>
  sqlRows(
    `SELECT id, amount::text a, credit_total_at_payment::text c, balance_after_payment::text b
       FROM payments WHERE invoice_id = $1 ORDER BY balance_after_payment DESC, id`,
    [invoiceId],
  );

// ------------------------------------------------------------ receipt snapshots

test('snapshot: a payment records the credit total and the balance remaining after it', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const first = await pay(org, invoiceId, '30.00').expect(201);
  assert.equal(first.body.payment.creditTotalAtPayment, '0.00');
  assert.equal(first.body.payment.balanceAfterPayment, '70.00');
  await credit(org, invoiceId, '-20.00').expect(201);
  const second = await pay(org, invoiceId, '30.00').expect(201);
  assert.equal(second.body.payment.creditTotalAtPayment, '-20.00');
  assert.equal(second.body.payment.balanceAfterPayment, '20.00'); // 100 - 30 - 20 - 30
  const rows = await paymentRows(invoiceId);
  assert.deepEqual(
    rows.map((r) => [r.c, r.b]),
    [
      ['0.00', '70.00'],
      ['-20.00', '20.00'],
    ],
  );
});

test('snapshot: a later credit or reversal never rewrites an earlier receipt', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00');
  const paid = await pay(org, invoiceId, '40.00').expect(201);
  const before = await get(org, `/finance/invoices/${invoiceId}/receipt`).expect(200);
  assert.equal(before.body.receipts[0].balanceAfterPayment, '60.00');
  assert.equal(before.body.receipts[0].balanceSource, 'recorded');

  await credit(org, invoiceId, '-10.00').expect(201);
  const afterCredit = await get(org, `/finance/invoices/${invoiceId}/receipt`).expect(200);
  assert.equal(
    afterCredit.body.receipts[0].balanceAfterPayment,
    '60.00',
    'credit does not change it',
  );
  assert.equal(afterCredit.body.receipts[0].creditTotalAtPayment, '0.00');
  assert.equal(afterCredit.body.invoice.balance, '50.00', 'the invoice itself reflects the credit');

  const snapshot = await paymentRows(invoiceId);
  await reverse(org, paid.body.payment.id).expect(201);
  const afterReversal = await get(org, `/finance/invoices/${invoiceId}/receipt`).expect(200);
  assert.equal(afterReversal.body.receipts[0].reversed, true);
  assert.equal(
    afterReversal.body.receipts[0].balanceAfterPayment,
    '60.00',
    'reversal marks, never rewrites',
  );
  assert.deepEqual(await paymentRows(invoiceId), snapshot, 'stored snapshot columns untouched');
});

test('snapshot: the database overwrites any snapshot values a caller supplies', async () => {
  const org = await newOrg();
  const { invoiceId, ids } = await issuedInvoice(org, '100.00');
  // A forged insert, read back inside the same transaction and then rolled back: the invoice's paid_amount is not updated by
  // a raw insert, so keeping the row would leave ledger drift.
  const forged = await rolledBack(async (c) => {
    const inserted = await c.query(
      `INSERT INTO payments (organization_id, invoice_id, resident_id, amount, method, received_at, updated_at,
                             credit_total_at_payment, balance_after_payment)
       VALUES ($1,$2,$3,25,'CASH',now(),now(), -99.00, 0.01) RETURNING credit_total_at_payment c, balance_after_payment b`,
      [org.orgId, invoiceId, ids.resident],
    );
    return inserted.rows[0];
  });
  assert.equal(forged.c, '0.00', 'forged credit total replaced');
  assert.equal(forged.b, '75.00', 'forged balance replaced by amount - paid - payment');
  assert.equal(
    await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [invoiceId]),
    0,
  );
  // and through the API, extra body fields are simply never read
  const viaApi = await pay(org, invoiceId, '10.00', {
    balanceAfterPayment: '0.01',
    creditTotalAtPayment: '-99.00',
  }).expect(201);
  // nothing was kept from the forged insert, so this payment sees a balance of 100 - 0 - 10
  assert.equal(viaApi.body.payment.balanceAfterPayment, '90.00');
  assert.notEqual(viaApi.body.payment.balanceAfterPayment, '0.01');
  assert.notEqual(viaApi.body.payment.creditTotalAtPayment, '-99.00');
});

test('snapshot: concurrent payments and credits produce receipts consistent with the actual lock order', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '1000.00');
  const calls = [
    ...Array.from({ length: 12 }, () => pay(org, invoiceId, '30.00')),
    ...Array.from({ length: 4 }, () => credit(org, invoiceId, '-10.00')),
  ];
  const results = await Promise.all(calls);
  assert.ok(
    results.every((r) => r.status === 201),
    JSON.stringify(results.map((r) => r.status)),
  );
  const rows = await paymentRows(invoiceId); // lock order == balance descending
  assert.equal(rows.length, 12);
  let previousCredit = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const credit = Number(row.c);
    assert.equal(
      Number(row.b),
      1000 - 30 * (index + 1) + credit,
      `payment #${index + 1}: balance must equal amount - cash so far - credits applied at that moment`,
    );
    assert.ok(
      credit <= 0 && credit >= -40 && credit <= previousCredit,
      'credit total only grows with the lock order',
    );
    previousCredit = credit;
  });
  const invoice = await invoiceRow(invoiceId);
  assert.equal(invoice.p, '400.00'); // 12 x 30 cash + 4 x 10 credit
});

test('snapshot: payments that pre-date the snapshot keep NULL and are shown as derived', async () => {
  const legacy = await sqlRows(
    `SELECT p.id payment_id, p.invoice_id, u.login_identifier email
       FROM payments p
       JOIN memberships m ON m.organization_id = p.organization_id AND m.status = 'ACTIVE'
       JOIN users u ON u.id = m.user_id
      WHERE p.balance_after_payment IS NULL AND p.credit_total_at_payment IS NULL
        AND u.login_identifier LIKE 'fin-%@nook.test.invalid'
      ORDER BY p.created_at LIMIT 1`,
  );
  if (legacy.length === 0) return; // a fresh database has no pre-snapshot payments
  const cookies = await login(legacy[0].email);
  const res = await server
    .get(`/api/v1/finance/invoices/${legacy[0].invoice_id}/receipt`)
    .set('Cookie', `${cookies.session}; ${cookies.csrf}`)
    .expect(200);
  const receipt = res.body.receipts.find((r: any) => r.paymentId === legacy[0].payment_id);
  assert.equal(receipt.balanceSource, 'derived');
  assert.equal(receipt.creditTotalAtPayment, null, 'no historical credit figure is invented');
  assert.match(receipt.balanceAfterPayment, /^\d+\.\d{2}$/);
});

// ------------------------------------------- payments against DRAFT / CANCELLED (database)

test('database: payments against DRAFT or CANCELLED invoices are refused for every role', async () => {
  const org = await newOrg();
  const draft = await draftFor(org);
  const insert = `INSERT INTO payments (organization_id, invoice_id, resident_id, amount, method, received_at, updated_at)
                  VALUES ($1,$2,$3,10,'CASH',now(),now())`;
  await refused(insert, [org.orgId, draft.id, draft.ids.resident], '23514');
  await withRuntimeClient(async (c) => {
    await assert.rejects(
      c.query(insert, [org.orgId, draft.id, draft.ids.resident]),
      (e: any) => e.code === '23514',
    );
  });
  await voidReq(org, draft.id).expect(201);
  await refused(insert, [org.orgId, draft.id, draft.ids.resident], '23514');
  assert.equal(await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [draft.id]), 0);
});

// ------------------------------------------------------------------- trigger hardening

test('guard: issued invoices cannot have their dates, notes, creation time, amount or identity changed', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00', future);
  for (const set of [
    `due_date = due_date + 1`,
    `issued_at = issued_at + interval '1 day'`,
    `issued_at = NULL`,
    `notes = 'rewritten'`,
    `created_at = created_at - interval '1 day'`,
    `amount = 1`,
    `number = 'INV-2099-0001'`,
    `period_start = period_start - 1`,
    `booking_id = NULL`,
  ]) {
    await refused(`UPDATE invoices SET ${set} WHERE id = $1`, [invoiceId], '23001');
  }
  const unchanged = await invoiceRow(invoiceId);
  assert.equal(unchanged.a, '100.00');
  // a PAID invoice is just as frozen
  await pay(org, invoiceId, '100.00').expect(201);
  await refused(`UPDATE invoices SET due_date = due_date + 1 WHERE id = $1`, [invoiceId], '23001');
});

test('guard: only the permitted status transitions are accepted', async () => {
  const org = await newOrg();
  const { invoiceId: issued } = await issuedInvoice(org, '100.00', future);
  const { invoiceId: paid } = await issuedInvoice(org, '100.00', future);
  await pay(org, paid, '100.00').expect(201);
  const draft = await draftFor(org);
  const setStatus = (id: string, status: string) =>
    refused(`UPDATE invoices SET status = '${status}' WHERE id = $1`, [id], '23001');

  await setStatus(paid, 'DRAFT');
  await setStatus(issued, 'DRAFT');
  await setStatus(issued, 'OVERDUE'); // overdue is derived, never stored
  await setStatus(draft.id, 'PAID');
  await setStatus(draft.id, 'PARTIALLY_PAID');
  await setStatus(draft.id, 'OVERDUE');
  await setStatus(issued, 'CANCELLED'); // not without a void record
  await setStatus(draft.id, 'CANCELLED');
  // an issue step must carry issued_at
  await refused(`UPDATE invoices SET status = 'ISSUED' WHERE id = $1`, [draft.id], '23514');
  // the legitimate step works: DRAFT -> ISSUED with issued_at and a due date in one update
  await withMigratorClient((c) =>
    c.query(
      `UPDATE invoices SET status = 'ISSUED', issued_at = now(), due_date = due_date + 3 WHERE id = $1`,
      [draft.id],
    ),
  );
  assert.equal((await invoiceRow(draft.id)).status, 'ISSUED');
  // invoices still cannot be deleted
  await refused(`DELETE FROM invoices WHERE id = $1`, [draft.id], '23001');
});

test('guard: a full legitimate lifecycle still works end to end', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00', future);
  const p1 = await pay(org, invoiceId, '40.00').expect(201); // ISSUED -> PARTIALLY_PAID
  await credit(org, invoiceId, '-10.00').expect(201);
  await reverse(org, p1.body.payment.id).expect(201); // back to ISSUED/PARTIALLY_PAID
  await pay(org, invoiceId, '90.00').expect(201); // -> PAID
  const done = await get(org, `/finance/invoices/${invoiceId}`).expect(200);
  assert.equal(done.body.storedStatus, 'PAID');
  assert.equal(done.body.balance, '0.00');
  await reverse(org, done.body.payments.at(-1).id).expect(201); // PAID -> back down
  assert.notEqual((await invoiceRow(invoiceId)).status, 'PAID');
});

// ----------------------------------------------------------------------------- voiding

test('void: a draft can be voided with a reason; the actor and previous state are recorded', async () => {
  const org = await newOrg();
  const draft = await draftFor(org, '640.00');
  const res = await voidReq(org, draft.id, '  Duplicate draft for the month  ').expect(201);
  assert.equal(res.body.invoice.storedStatus, 'CANCELLED');
  assert.equal(res.body.void.reason, 'Duplicate draft for the month');
  assert.equal(res.body.void.previousStatus, 'DRAFT');
  assert.equal(res.body.void.amountAtVoid, '640.00');
  const [row] = await sqlRows(
    `SELECT organization_id, invoice_id, voided_by, reason, previous_status, amount_at_void::text a, created_at
       FROM invoice_voids WHERE invoice_id = $1`,
    [draft.id],
  );
  assert.equal(row.organization_id, org.orgId);
  assert.equal(row.voided_by, org.userId);
  assert.equal(row.a, '640.00');
  assert.ok(row.created_at);
  const detail = await get(org, `/finance/invoices/${draft.id}`).expect(200);
  assert.equal(detail.body.void.voidedBy, 'Finance Tester');
  assert.equal(detail.body.legacyCancelled, false);
  assert.equal(
    await count(
      `SELECT count(*) n FROM audit_events WHERE organization_id = $1 AND target_id = $2 AND action = 'finance.invoice.voided'`,
      [org.orgId, draft.id],
    ),
    1,
  );
});

test('void: an issued unpaid invoice is voided, stops being outstanding, and can no longer be paid', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '500.00', future);
  const kept = await issuedInvoice(org, '300.00', future);
  const out0 = await get(org, '/finance/outstanding').expect(200);
  assert.equal(out0.body.totals.outstandingAmount, '800.00');
  const res = await voidReq(org, invoiceId).expect(201);
  assert.equal(res.body.void.previousStatus, 'ISSUED');
  const out1 = await get(org, '/finance/outstanding').expect(200);
  assert.equal(out1.body.totals.outstandingAmount, '300.00');
  assert.deepEqual(
    out1.body.items.map((i: any) => i.id),
    [kept.invoiceId],
  );
  const report = await get(org, `/finance/reports/monthly?month=${monthStr}`).expect(200);
  assert.equal(report.body.months.at(-1).invoiced, '300.00', 'voided invoices are not billed');
  await pay(org, invoiceId, '10').expect(400);
  await credit(org, invoiceId, '-10.00').expect(400);
  await refused(`UPDATE invoices SET status = 'ISSUED' WHERE id = $1`, [invoiceId], '23001');
});

test('void: refused while payments are unreversed, allowed once every payment is reversed', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '200.00', future);
  const p1 = await pay(org, invoiceId, '50.00').expect(201);
  const p2 = await pay(org, invoiceId, '25.00').expect(201);
  const blocked = await voidReq(org, invoiceId).expect(409);
  assert.match(blocked.body.message, /unreversed payments/i);
  await reverse(org, p1.body.payment.id).expect(201);
  await voidReq(org, invoiceId).expect(409); // one is still held
  await reverse(org, p2.body.payment.id).expect(201);

  const before = await sqlRows(
    `SELECT (SELECT md5(string_agg(p::text, '|' ORDER BY p.id)) FROM payments p WHERE invoice_id = $1) pay,
            (SELECT md5(string_agg(r::text, '|' ORDER BY r.id)) FROM payment_reversals r WHERE invoice_id = $1) rev`,
    [invoiceId],
  );
  await voidReq(org, invoiceId, 'Resident never moved in').expect(201);
  const after = await sqlRows(
    `SELECT (SELECT md5(string_agg(p::text, '|' ORDER BY p.id)) FROM payments p WHERE invoice_id = $1) pay,
            (SELECT md5(string_agg(r::text, '|' ORDER BY r.id)) FROM payment_reversals r WHERE invoice_id = $1) rev`,
    [invoiceId],
  );
  assert.deepEqual(after, before, 'payments and reversals are byte-identical after the void');
  const detail = await get(org, `/finance/invoices/${invoiceId}`).expect(200);
  assert.equal(detail.body.payments.length, 2, 'payment history kept');
  assert.ok(detail.body.payments.every((p: any) => p.reversed));
  assert.equal(
    await count(`SELECT count(*) n FROM invoice_voids WHERE invoice_id = $1`, [invoiceId]),
    1,
  );
});

test('void: refused for ever once a credit is applied (credits cannot be reversed)', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '200.00', future);
  await credit(org, invoiceId, '-30.00').expect(201);
  const res = await voidReq(org, invoiceId).expect(409);
  assert.match(res.body.message, /credits/i);
  assert.equal(
    await count(`SELECT count(*) n FROM invoice_voids WHERE invoice_id = $1`, [invoiceId]),
    0,
  );
  assert.equal((await invoiceRow(invoiceId)).status, 'ISSUED');
});

test('void: a second or racing void is a conflict and leaves exactly one record', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '150.00', future);
  await voidReq(org, invoiceId).expect(201);
  const again = await voidReq(org, invoiceId).expect(409);
  assert.match(again.body.message, /already voided/i);

  const racers = await issuedInvoice(org, '175.00', future);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => voidReq(org, racers.invoiceId)),
  );
  assert.equal(
    results.filter((r) => r.status === 201).length,
    1,
    JSON.stringify(results.map((r) => r.status)),
  );
  assert.equal(results.filter((r) => r.status === 409).length, 5);
  assert.equal(
    await count(`SELECT count(*) n FROM invoice_voids WHERE invoice_id = $1`, [racers.invoiceId]),
    1,
  );
});

test('void: a payment racing a void leaves a consistent result either way', async () => {
  for (let round = 0; round < 6; round += 1) {
    const org = await newOrg();
    const { invoiceId } = await issuedInvoice(org, '100.00', future);
    const [v, p] = await Promise.all([voidReq(org, invoiceId), pay(org, invoiceId, '40.00')]);
    const row = await invoiceRow(invoiceId);
    const payments = await count(`SELECT count(*) n FROM payments WHERE invoice_id = $1`, [
      invoiceId,
    ]);
    if (v.status === 201) {
      assert.equal(row.status, 'CANCELLED');
      assert.equal(payments, 0, 'a voided invoice holds no payment');
      assert.equal(p.status, 400);
    } else {
      assert.equal(v.status, 409);
      assert.equal(p.status, 201);
      assert.equal(payments, 1);
      assert.notEqual(row.status, 'CANCELLED');
    }
  }
});

test('void: validation, authentication and organization isolation', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const { invoiceId } = await issuedInvoice(orgA, '100.00', future);
  await post(orgA, `/finance/invoices/${invoiceId}/void`, {}).expect(400);
  await voidReq(orgA, invoiceId, '').expect(400);
  await voidReq(orgA, invoiceId, 'ab').expect(400);
  await voidReq(orgA, invoiceId, 'x'.repeat(501)).expect(400);
  await voidReq(orgA, invoiceId, 42).expect(400);
  await voidReq(orgA, 'not-a-uuid').expect(400);
  await voidReq(orgA, randomUUID()).expect(404);
  await voidReq(orgB, invoiceId).expect(404); // another organization's invoice
  await server
    .post(`/api/v1/finance/invoices/${invoiceId}/void`)
    .set('Origin', ORIGIN)
    .send({ reason: 'abc' })
    .expect(401);
  await server
    .post(`/api/v1/finance/invoices/${invoiceId}/void`)
    .set('Origin', 'https://evil.example')
    .set('Cookie', `${orgA.cookies.session}; ${orgA.cookies.csrf}`)
    .set('x-csrf-token', orgA.cookies.token)
    .send({ reason: 'abc' })
    .expect(403);
  await server
    .post(`/api/v1/finance/invoices/${invoiceId}/void`)
    .set('Origin', ORIGIN)
    .set('Cookie', `${orgA.cookies.session}; ${orgA.cookies.csrf}`)
    .set('x-csrf-token', 'wrong')
    .send({ reason: 'abc' })
    .expect(403);
  assert.equal(
    await count(`SELECT count(*) n FROM invoice_voids WHERE invoice_id = $1`, [invoiceId]),
    0,
  );
  // a client-supplied organization or actor is ignored
  const res = await post(orgA, `/finance/invoices/${invoiceId}/void`, {
    reason: 'Spoof attempt',
    organizationId: orgB.orgId,
    voidedBy: orgB.userId,
  }).expect(201);
  assert.equal(res.body.void.voidedBy, 'Finance Tester');
  const [row] = await sqlRows(
    `SELECT organization_id, voided_by FROM invoice_voids WHERE invoice_id = $1`,
    [invoiceId],
  );
  assert.equal(row.organization_id, orgA.orgId);
  assert.equal(row.voided_by, orgA.userId);
  await get(orgB, `/finance/invoices/${invoiceId}`).expect(404);
});

test('void: the property manager may void as well', async () => {
  const manager = await newOrg('PROPERTY_MANAGER');
  const { invoiceId } = await issuedInvoice(manager, '100.00', future);
  await voidReq(manager, invoiceId).expect(201);
});

test('void: a failure after the void insert rolls the whole transaction back', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00', future);
  const fn = `fin_test_fail_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  assertFaultInjectionName(fn); // only a per-run, test-owned name may be created or dropped
  await withMigratorClient(async (c) => {
    await c.query(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
      IF NEW.action = 'finance.invoice.voided' AND NEW.organization_id = '${org.orgId}' THEN RAISE EXCEPTION 'forced failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await c.query(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
  });
  try {
    await voidReq(org, invoiceId).expect(500);
    assert.equal((await invoiceRow(invoiceId)).status, 'ISSUED', 'status untouched');
    assert.equal(
      await count(`SELECT count(*) n FROM invoice_voids WHERE invoice_id = $1`, [invoiceId]),
      0,
      'void row rolled back',
    );
  } finally {
    await withMigratorClient(async (c) => {
      await c.query(`DROP TRIGGER IF EXISTS ${fn} ON audit_events`);
      await c.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    });
  }
  await voidReq(org, invoiceId).expect(201); // healthy again
});

// ---------------------------------------------------- invoice_voids at the database level

test('invoice_voids: append-only, organization-bound, rule-checked and caller-proof', async () => {
  const orgA = await newOrg();
  const orgB = await newOrg();
  const a = await issuedInvoice(orgA, '100.00', future);
  const b = await issuedInvoice(orgB, '100.00', future);
  const paid = await issuedInvoice(orgA, '100.00', future);
  await pay(orgA, paid.invoiceId, '10.00').expect(201);
  const insert = `INSERT INTO invoice_voids (organization_id, invoice_id, resident_id, previous_status, amount_at_void, reason, voided_by)`;

  // composite foreign keys: the invoice must belong to the stated organization and resident
  await refused(
    `${insert} VALUES ($1,$2,$3,'ISSUED',1,'cross organization',$4)`,
    [orgB.orgId, a.invoiceId, a.ids.resident, orgB.userId],
    '23503',
  );
  await refused(
    `${insert} VALUES ($1,$2,$3,'ISSUED',1,'wrong resident',$4)`,
    [orgA.orgId, a.invoiceId, b.ids.resident, orgA.userId],
    '23503',
  );
  // the database refuses a void while money is settled
  await refused(
    `${insert} VALUES ($1,$2,$3,'ISSUED',1,'has a payment',$4)`,
    [orgA.orgId, paid.invoiceId, paid.ids.resident, orgA.userId],
    '23514',
  );
  // a short reason is refused
  await refused(
    `${insert} VALUES ($1,$2,$3,'ISSUED',1,'ab',$4)`,
    [orgA.orgId, a.invoiceId, a.ids.resident, orgA.userId],
    '23514',
  );

  // a valid insert records what the DATABASE read from the invoice, not what was claimed
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`${insert} VALUES ($1,$2,$3,'DRAFT',999,'forged claims ignored',$4)`, [
      orgA.orgId,
      a.invoiceId,
      a.ids.resident,
      orgA.userId,
    ]);
    const r = await c.query(
      `SELECT previous_status, amount_at_void::text a FROM invoice_voids WHERE invoice_id = $1`,
      [a.invoiceId],
    );
    assert.equal(r.rows[0].previous_status, 'ISSUED');
    assert.equal(r.rows[0].a, '100.00');
    await c.query('ROLLBACK');
  });
  // a void record on its own does not cancel anything; only the guarded status update does
  assert.equal((await invoiceRow(a.invoiceId)).status, 'ISSUED');

  await voidReq(orgA, a.invoiceId).expect(201);
  // one per invoice, and the record can never be edited or removed
  await refused(
    `${insert} VALUES ($1,$2,$3,'ISSUED',1,'second void',$4)`,
    [orgA.orgId, a.invoiceId, a.ids.resident, orgA.userId],
    '23505',
  );
  await refused(
    `UPDATE invoice_voids SET reason = 'changed' WHERE invoice_id = $1`,
    [a.invoiceId],
    '23001',
  );
  await refused(`DELETE FROM invoice_voids WHERE invoice_id = $1`, [a.invoiceId], '23001');
  await withRuntimeClient(async (c) => {
    await assert.rejects(
      c.query(`UPDATE invoice_voids SET reason = 'changed' WHERE invoice_id = $1`, [a.invoiceId]),
      (e: any) => e.code === '42501',
    );
    await assert.rejects(
      c.query(`DELETE FROM invoice_voids WHERE invoice_id = $1`, [a.invoiceId]),
      (e: any) => e.code === '42501',
    );
  });
});

// ------------------------------------------------------ legacy CANCELLED invoices

test('legacy: a CANCELLED invoice without a void record stays visible, frozen, unpayable and uninvented', async () => {
  const org = await newOrg();
  // An intentional, cleanup-free fixture: the API must see this row, so it is committed. It lives in its own organization,
  // which is registered so the hygiene test at the end of the file expects exactly this and nothing else.
  legacyFixtureOrgs.add(org.orgId);
  const ids = await seedResident(org, { price: '420.00' });
  // inserted directly, as invoices cancelled before void records existed were
  const legacyId = randomUUID();
  await withMigratorClient((c) =>
    c.query(
      `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, updated_at)
       VALUES ($1,$2,$3,$4,'INV-2090-0001',$5,$5,420,$5,'CANCELLED',now())`,
      [legacyId, org.orgId, ids.resident, ids.booking, `${monthStr}-01`],
    ),
  );
  const detail = await get(org, `/finance/invoices/${legacyId}`).expect(200);
  assert.equal(detail.body.storedStatus, 'CANCELLED');
  assert.equal(detail.body.void, null, 'no void record is invented');
  assert.equal(detail.body.legacyCancelled, true);
  assert.equal(
    await count(`SELECT count(*) n FROM invoice_voids WHERE invoice_id = $1`, [legacyId]),
    0,
  );
  const listed = await get(org, '/finance/invoices?status=CANCELLED').expect(200);
  assert.ok(listed.body.items.some((i: any) => i.id === legacyId));

  await voidReq(org, legacyId).expect(409);
  await pay(org, legacyId, '10').expect(400);
  await credit(org, legacyId, '-10.00').expect(400);
  await refused(`UPDATE invoices SET notes = 'x' WHERE id = $1`, [legacyId], '23001');
  await refused(`UPDATE invoices SET status = 'ISSUED' WHERE id = $1`, [legacyId], '23001');
  const out = await get(org, '/finance/outstanding').expect(200);
  assert.equal(out.body.totals.outstandingAmount, '0.00');
  const report = await get(org, `/finance/reports/monthly?month=${monthStr}`).expect(200);
  assert.equal(report.body.months.at(-1).invoiced, '0.00');
});

// ------------------------------------------------- status/amount consistency (invoices_status_matches_amounts)
//
// The constraint tested here is migration 20261103120000_invoice_status_consistency; these tests need it applied to the
// database they run against. Every direct-SQL probe runs in a transaction that is ALWAYS rolled back, so a probe can never
// leave a contradictory ledger row behind, with or without the constraint.

/** Runs `fn` in a transaction that is rolled back whatever happens. */
async function rolledBack<T>(fn: (c: any) => Promise<T>): Promise<T> {
  return withMigratorClient(async (c) => {
    await c.query('BEGIN');
    try {
      return await fn(c);
    } finally {
      await c.query('ROLLBACK');
    }
  });
}

/** Direct SQL must be refused by the status/amount CHECK itself (not by another guard); nothing is ever kept. */
const refusedByStatusRule = (query: string, params: unknown[]) =>
  assert.rejects(
    rolledBack((c) => c.query(query, params)),
    (e: any) => e.code === '23514' && e.constraint === 'invoices_status_matches_amounts',
    `expected invoices_status_matches_amounts for: ${query.slice(0, 80)}`,
  );

/** Invoices of one organization whose stored status contradicts their amounts. */
const contradictingInvoices = (orgId: string) =>
  count(
    `SELECT count(*) n FROM invoices WHERE organization_id = $1 AND status NOT IN ('DRAFT','CANCELLED')
       AND NOT (
            (status = 'PAID' AND paid_amount = amount)
         OR (status = 'PARTIALLY_PAID' AND paid_amount < amount AND paid_amount + adjustment_total > 0)
         OR (status = 'ISSUED' AND paid_amount < amount AND paid_amount + adjustment_total <= 0)
         OR (status = 'OVERDUE' AND paid_amount < amount))`,
    [orgId],
  );

test('status rule probes leave no trace, with or without the constraint', async () => {
  const org = await newOrg();
  const { invoiceId: unpaid } = await issuedInvoice(org, '100.00', future);
  const { invoiceId: paid } = await issuedInvoice(org, '100.00', future);
  await pay(org, paid, '100.00').expect(201);
  const { invoiceId: partial } = await issuedInvoice(org, '100.00', future);
  await pay(org, partial, '40.00').expect(201);

  // The exact statements the constraint tests use. Whether each is accepted (no constraint yet) or refused (constraint
  // applied) does not matter here: what matters is that none of them survives.
  const probes: Array<[string, string]> = [
    [`UPDATE invoices SET status = 'PARTIALLY_PAID' WHERE id = $1`, unpaid],
    [`UPDATE invoices SET paid_amount = amount WHERE id = $1`, unpaid],
    [`UPDATE invoices SET paid_amount = 50 WHERE id = $1`, unpaid],
    [`UPDATE invoices SET status = 'ISSUED' WHERE id = $1`, paid],
    [`UPDATE invoices SET status = 'PARTIALLY_PAID' WHERE id = $1`, paid],
    [`UPDATE invoices SET status = 'ISSUED' WHERE id = $1`, partial],
  ];
  for (const [query, id] of probes) {
    await rolledBack(async (c) => {
      try {
        await c.query(query, [id]);
      } catch {
        // refused: fine
      }
    });
  }
  const rows = await Promise.all([unpaid, paid, partial].map((id) => invoiceRow(id)));
  assert.deepEqual(
    rows.map((r) => [r.status, r.p]),
    [
      ['ISSUED', '0.00'],
      ['PAID', '100.00'],
      ['PARTIALLY_PAID', '40.00'],
    ],
  );
  assert.equal(
    await contradictingInvoices(org.orgId),
    0,
    'no contradictory ledger row was left behind',
  );
});

test('status rule: direct SQL cannot make the stored status contradict the amounts (F1, F2, F3)', async () => {
  const org = await newOrg();
  const { invoiceId: unpaid } = await issuedInvoice(org, '100.00', future);
  const { invoiceId: paid } = await issuedInvoice(org, '100.00', future);
  await pay(org, paid, '100.00').expect(201);
  const { invoiceId: partial } = await issuedInvoice(org, '100.00', future);
  await pay(org, partial, '40.00').expect(201);
  try {
    // F1: PARTIALLY_PAID with nothing paid
    await refusedByStatusRule(`UPDATE invoices SET status = 'PARTIALLY_PAID' WHERE id = $1`, [
      unpaid,
    ]);
    // F2: money recorded as settled while the status still says ISSUED (fully, and partly in cash)
    await refusedByStatusRule(`UPDATE invoices SET paid_amount = amount WHERE id = $1`, [unpaid]);
    await refusedByStatusRule(`UPDATE invoices SET paid_amount = 50 WHERE id = $1`, [unpaid]);
    // F3: a fully paid invoice cannot be relabelled, and a part-paid one cannot be relabelled ISSUED
    await refusedByStatusRule(`UPDATE invoices SET status = 'ISSUED' WHERE id = $1`, [paid]);
    await refusedByStatusRule(`UPDATE invoices SET status = 'PARTIALLY_PAID' WHERE id = $1`, [
      paid,
    ]);
    await refusedByStatusRule(`UPDATE invoices SET status = 'ISSUED' WHERE id = $1`, [partial]);
  } finally {
    // even when an assertion above fails, nothing was kept
    assert.equal(await contradictingInvoices(org.orgId), 0);
  }
});

test('status rule: a consistent change in one statement is accepted, in both directions', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00', future);
  const inside = await rolledBack(async (c) => {
    await c.query(`UPDATE invoices SET paid_amount = 10, status = 'PARTIALLY_PAID' WHERE id = $1`, [
      invoiceId,
    ]);
    await c.query(`UPDATE invoices SET paid_amount = 0, status = 'ISSUED' WHERE id = $1`, [
      invoiceId,
    ]);
    await c.query(`UPDATE invoices SET paid_amount = amount, status = 'PAID' WHERE id = $1`, [
      invoiceId,
    ]);
    return (await c.query(`SELECT status FROM invoices WHERE id = $1`, [invoiceId])).rows[0].status;
  });
  assert.equal(inside, 'PAID', 'accepted inside the transaction');
  assert.equal((await invoiceRow(invoiceId)).status, 'ISSUED', 'and rolled back afterwards');
});

test('status rule: a credit-only partial settlement stays ISSUED and is valid; a full credit is PAID', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00', future);
  await credit(org, invoiceId, '-30.00', 'Rebate for a closed facility').expect(201);
  const credited = await invoiceRow(invoiceId);
  assert.deepEqual([credited.status, credited.p, credited.adj], ['ISSUED', '30.00', '-30.00']);
  try {
    // the row stays valid when touched, and cannot be relabelled as cash-paid
    await rolledBack((c) =>
      c.query(`UPDATE invoices SET updated_at = now() WHERE id = $1`, [invoiceId]),
    );
    await refusedByStatusRule(`UPDATE invoices SET status = 'PARTIALLY_PAID' WHERE id = $1`, [
      invoiceId,
    ]);
  } finally {
    assert.equal(await contradictingInvoices(org.orgId), 0);
  }
  // cash on top of the credit makes it PARTIALLY_PAID, settling the rest makes it PAID
  await pay(org, invoiceId, '20.00').expect(201);
  assert.equal((await invoiceRow(invoiceId)).status, 'PARTIALLY_PAID');
  await pay(org, invoiceId, '50.00').expect(201);
  assert.equal((await invoiceRow(invoiceId)).status, 'PAID');

  const { invoiceId: whole } = await issuedInvoice(org, '100.00', future);
  await credit(org, whole, '-100.00', 'Full waiver').expect(201);
  assert.equal((await invoiceRow(whole)).status, 'PAID');
});

test('credit-only partial settlements and full credits behave through the API (no direct SQL)', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00', future);
  await credit(org, invoiceId, '-30.00', 'Rebate for a closed facility').expect(201);
  const credited = await invoiceRow(invoiceId);
  assert.deepEqual([credited.status, credited.p, credited.adj], ['ISSUED', '30.00', '-30.00']);
  await pay(org, invoiceId, '20.00').expect(201);
  assert.equal((await invoiceRow(invoiceId)).status, 'PARTIALLY_PAID');
  await pay(org, invoiceId, '50.00').expect(201);
  assert.equal((await invoiceRow(invoiceId)).status, 'PAID');
  const { invoiceId: whole } = await issuedInvoice(org, '100.00', future);
  await credit(org, whole, '-100.00', 'Full waiver').expect(201);
  assert.equal((await invoiceRow(whole)).status, 'PAID');
  assert.equal(await contradictingInvoices(org.orgId), 0);
});

test('status rule: reversals and later credits keep status and amounts consistent through the API', async () => {
  const org = await newOrg();
  const { invoiceId } = await issuedInvoice(org, '100.00', future);
  const p1 = await pay(org, invoiceId, '60.00').expect(201);
  await credit(org, invoiceId, '-10.00', 'Late fee waived').expect(201);
  await reverse(org, p1.body.payment.id).expect(201);
  const after = await invoiceRow(invoiceId);
  assert.deepEqual([after.status, after.p, after.adj], ['ISSUED', '10.00', '-10.00']);
  await pay(org, invoiceId, '90.00').expect(201);
  assert.equal((await invoiceRow(invoiceId)).status, 'PAID');
  assert.equal(await contradictingInvoices(org.orgId), 0, 'no invoice contradicts the rule');
});

test('status rule: a legacy OVERDUE label is tolerated while the invoice is open, never when it is fully paid', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, { price: '300.00' });
  const insert = (c: any, n: number, paid: number) =>
    c.query(
      `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount,
                               paid_amount, due_date, status, issued_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6,300,$7,$6,'OVERDUE',now(),now())`,
      [
        randomUUID(),
        org.orgId,
        ids.resident,
        ids.booking,
        `INV-2091-000${n}`,
        `2091-0${n}-01`,
        paid,
      ],
    );
  // open legacy invoices are accepted (inside a transaction that is rolled back) ...
  await rolledBack(async (c) => {
    await insert(c, 1, 0);
    await insert(c, 2, 100);
  });
  // ... a fully paid one labelled OVERDUE is not
  await assert.rejects(
    rolledBack((c) => insert(c, 3, 300)),
    (e: any) => e.code === '23514' && e.constraint === 'invoices_status_matches_amounts',
  );
  assert.equal(
    await count(`SELECT count(*) n FROM invoices WHERE organization_id = $1`, [org.orgId]),
    0,
    'the probes kept nothing',
  );
});

// ------------------------------------------------- invoice uniqueness: one invoice per booking per billing month
//
// Frozen billing policy: ONE ACTIVE INVOICE PER BOOKING PER BILLING MONTH. Separate bookings are billed independently, an
// approved extension stays part of its booking, invoices are never merged, and a VOIDED invoice does not occupy the slot
// (void and reissue). Needs migrations 20261103120000 and 20261103130000 on the database under test.
// See docs/nook-phase-3/TASK_4F_INVOICE_UNIQUENESS_MODEL.md.

/** A second stay for the same resident: another bed, booking, admission and check-in. */
async function seedSecondStay(
  org: Org,
  residentId: string,
  opts: { checkInAt: Date; price: string },
) {
  const ids = {
    bed: randomUUID(),
    booking: randomUUID(),
    admission: randomUUID(),
    checkIn: randomUUID(),
  };
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
      [ids.bed, org.orgId, org.propertyId, org.roomId, `B-${ids.bed.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'CONFIRMED',now())`,
      [
        ids.booking,
        org.orgId,
        residentId,
        ids.bed,
        opts.checkInAt,
        new Date(opts.checkInAt.getTime() + 365 * DAY),
        opts.price,
      ],
    );
    await c.query(
      `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'ADMITTED',now())`,
      [ids.admission, org.orgId, ids.booking, residentId, ids.bed, opts.checkInAt],
    );
    await c.query(
      `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',now())`,
      [ids.checkIn, org.orgId, ids.admission, residentId, ids.bed, ids.booking, opts.checkInAt],
    );
    await c.query('COMMIT');
  });
  return ids;
}

const draftReq = (org: Org, residentId: string, bookingId: string, month = monthStr) =>
  post(org, '/finance/invoices', { residentId, bookingId, month });
const activeFor = (orgId: string, bookingId: string) =>
  count(
    `SELECT count(*) n FROM invoices WHERE organization_id = $1 AND booking_id = $2 AND period_start = $3 AND status <> 'CANCELLED'`,
    [orgId, bookingId, `${monthStr}-01`],
  );

test('uniqueness: a second ACTIVE invoice for the same booking and month is refused by the API and by the database', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, { price: '1200.00' });
  const first = await draftReq(org, ids.resident, ids.booking).expect(201);
  const again = await draftReq(org, ids.resident, ids.booking);
  assert.equal(again.status, 409);
  assert.match(String(again.body.message), /already exists/i);
  // also once the first one is issued and paid
  await post(org, `/finance/invoices/${first.body.id}/issue`, {}).expect(201);
  await pay(org, first.body.id, '1200.00').expect(201);
  assert.equal((await draftReq(org, ids.resident, ids.booking)).status, 409);
  // the database refuses it too (an in-transaction probe that is always rolled back)
  await assert.rejects(
    rolledBack((c) =>
      c.query(
        `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, updated_at)
         VALUES ($1,$2,$3,$4,'INV-2098-0001',$5,$5,1200,$5,'DRAFT',now())`,
        [randomUUID(), org.orgId, ids.resident, ids.booking, `${monthStr}-01`],
      ),
    ),
    (e: any) => e.code === '23505',
  );
  assert.equal(await activeFor(org.orgId, ids.booking), 1);
});

test('uniqueness: concurrent drafts for one booking and month create exactly one active invoice', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, { price: '900.00' });
  const results = await Promise.all(
    Array.from({ length: 6 }, () => draftReq(org, ids.resident, ids.booking)),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(
    results.every((r) => [201, 409].includes(r.status)),
    results.map((r) => r.status).join(),
  );
  assert.equal(await activeFor(org.orgId, ids.booking), 1);
});

test('void and reissue: a voided invoice frees its booking and month for a replacement; history and audit are kept', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, { price: '1500.00' });
  const original = await draftReq(org, ids.resident, ids.booking).expect(201);
  await post(org, `/finance/invoices/${original.body.id}/issue`, {}).expect(201);
  await voidReq(org, original.body.id, 'Issued with the wrong period').expect(201);

  // the replacement is accepted, gets a NEW number, and is the only active invoice
  const replacement = await draftReq(org, ids.resident, ids.booking).expect(201);
  assert.notEqual(replacement.body.id, original.body.id);
  assert.notEqual(replacement.body.number, original.body.number);
  assert.equal(await activeFor(org.orgId, ids.booking), 1);
  await post(org, `/finance/invoices/${replacement.body.id}/issue`, {}).expect(201);
  await pay(org, replacement.body.id, '1500.00').expect(201);

  // the voided invoice, its void record and its audit trail are untouched
  const old = await get(org, `/finance/invoices/${original.body.id}`).expect(200);
  assert.equal(old.body.storedStatus, 'CANCELLED');
  assert.equal(old.body.void.reason, 'Issued with the wrong period');
  assert.equal(
    await count(`SELECT count(*) n FROM invoice_voids WHERE invoice_id = $1`, [original.body.id]),
    1,
  );
  assert.equal(
    await count(
      `SELECT count(*) n FROM audit_events WHERE organization_id = $1 AND target_id = $2 AND action IN ('finance.invoice.issued','finance.invoice.voided')`,
      [org.orgId, original.body.id],
    ),
    2,
  );
  // only the replacement is outstanding-relevant: nothing is open for this resident
  const outstanding = await get(org, '/finance/outstanding').expect(200);
  assert.equal(outstanding.body.totals.outstandingAmount, '0.00');

  // a second void-and-reissue cycle works as well, and the active invoice is still unique
  await draftReq(org, ids.resident, ids.booking).expect(409);
});

test('void and reissue: monthly generation replaces a voided invoice exactly once and is idempotent', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, { price: '2000.00' });
  const first = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: true,
  }).expect(201);
  assert.equal(first.body.created, 1);
  const original = first.body.invoices[0];
  await voidReq(org, original.id, 'Wrong amount').expect(201);

  const second = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: true,
  }).expect(201);
  assert.equal(second.body.created, 1, 'the voided month is billed again');
  assert.notEqual(second.body.invoices[0].id, original.id);
  const third = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: true,
  }).expect(201);
  assert.equal(third.body.created, 0, 'and only once');
  assert.equal(await activeFor(org.orgId, ids.booking), 1);
  assert.equal(
    await count(
      `SELECT count(*) n FROM invoices WHERE organization_id = $1 AND booking_id = $2 AND status = 'CANCELLED'`,
      [org.orgId, ids.booking],
    ),
    1,
    'the voided invoice is kept',
  );
  // exactly one issued event per invoice that was created (two over the whole test)
  assert.equal(
    await count(
      `SELECT count(*) n FROM audit_events WHERE organization_id = $1 AND action = 'finance.invoice.issued'`,
      [org.orgId],
    ),
    2,
  );
});

test('bed transfer: two bookings of one resident in one month produce two separate full-month invoices, once', async () => {
  const org = await newOrg();
  // stay A: checked out mid-month; stay B: a different bed and price, checked in afterwards
  const a = await seedResident(org, {
    price: '5000.00',
    checkInAt: new Date(monthStart.getTime() + 2 * DAY),
    checkedOutAt: new Date(monthStart.getTime() + 14 * DAY),
  });
  const b = await seedSecondStay(org, a.resident, {
    checkInAt: new Date(monthStart.getTime() + 15 * DAY),
    price: '6500.00',
  });

  const run = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: false,
  }).expect(201);
  assert.equal(run.body.created, 2, 'one invoice per booking');
  const amounts = run.body.invoices.map((i: any) => i.amount).sort();
  assert.deepEqual(
    amounts,
    ['5000.00', '6500.00'],
    'each booking at its own full price, no proration, no merging',
  );
  assert.equal(await activeFor(org.orgId, a.booking), 1);
  assert.equal(await activeFor(org.orgId, b.booking), 1);

  const again = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: false,
  }).expect(201);
  assert.equal(again.body.created, 0, 'idempotent');

  // a manual draft for a booking that already has its invoice is still refused; a different booking is not
  assert.equal((await draftReq(org, a.resident, a.booking)).status, 409);
  assert.equal((await draftReq(org, a.resident, b.booking)).status, 409);
});

test('multi-booking: an approved extension stays on its booking and never creates a second invoice', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, {
    price: '4000.00',
    bookingStart: new Date(monthStart.getTime() - 40 * DAY),
    bookingEnd: new Date(monthStart.getTime() + 20 * DAY),
    checkInAt: new Date(monthStart.getTime() - 40 * DAY),
  });
  const first = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: false,
  }).expect(201);
  assert.equal(first.body.created, 1);
  await withMigratorClient((c) =>
    c.query(`UPDATE bookings SET end_date = end_date + interval '45 days' WHERE id = $1`, [
      ids.booking,
    ]),
  );
  const afterExtension = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: false,
  }).expect(201);
  assert.equal(afterExtension.body.created, 0);
  assert.equal(await activeFor(org.orgId, ids.booking), 1);
});

test('bed transfer, issued: each booking has its own invoice, audit event and payment trail', async () => {
  const org = await newOrg();
  const a = await seedResident(org, {
    price: '5000.00',
    checkInAt: new Date(monthStart.getTime() + 2 * DAY),
    checkedOutAt: new Date(monthStart.getTime() + 14 * DAY),
  });
  const b = await seedSecondStay(org, a.resident, {
    checkInAt: new Date(monthStart.getTime() + 15 * DAY),
    price: '6500.00',
  });
  const run = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: true,
  }).expect(201);
  assert.equal(run.body.created, 2);
  assert.equal(run.body.eligibleBookings, 2);
  assert.equal(run.body.eligibleResidents, 1, 'one resident, two bookings');
  assert.equal(run.body.skippedExisting, 0);
  const byBooking = new Map<string, any>(run.body.invoices.map((i: any) => [i.bookingId, i]));
  assert.equal(
    byBooking.get(a.booking)!.amount,
    '5000.00',
    'the first booking: full price, no proration',
  );
  assert.equal(
    byBooking.get(b.booking)!.amount,
    '6500.00',
    'the second booking: full price, no proration',
  );
  assert.notEqual(byBooking.get(a.booking)!.number, byBooking.get(b.booking)!.number);

  // exactly one issued event per invoice, and a rerun adds none
  const issuedEvents = () =>
    count(
      `SELECT count(*) n FROM audit_events WHERE organization_id = $1 AND action = 'finance.invoice.issued'`,
      [org.orgId],
    );
  assert.equal(await issuedEvents(), 2);
  const rerun = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: true,
  }).expect(201);
  assert.equal(rerun.body.created, 0);
  assert.equal(rerun.body.skippedExisting, 2);
  assert.equal(await issuedEvents(), 2, 'no duplicate audit events on a rerun');

  // the invoices are independent: paying one leaves the other open
  await pay(org, byBooking.get(a.booking)!.id, '5000.00').expect(201);
  assert.equal((await invoiceRow(byBooking.get(a.booking)!.id)).status, 'PAID');
  assert.equal((await invoiceRow(byBooking.get(b.booking)!.id)).status, 'ISSUED');
  const outstanding = await get(org, '/finance/outstanding').expect(200);
  assert.equal(outstanding.body.totals.outstandingAmount, '6500.00');

  // voiding one booking's invoice neither touches the other nor blocks its own reissue
  await voidReq(org, byBooking.get(b.booking)!.id, 'Wrong rent for the new bed').expect(201);
  assert.equal((await invoiceRow(byBooking.get(a.booking)!.id)).status, 'PAID');
  const again = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: true,
  }).expect(201);
  assert.equal(again.body.created, 1, 'only the voided booking is billed again');
  assert.equal(again.body.invoices[0].bookingId, b.booking);
  assert.equal(await activeFor(org.orgId, a.booking), 1);
  assert.equal(await activeFor(org.orgId, b.booking), 1);
  assert.equal(await contradictingInvoices(org.orgId), 0);
});

test('legacy invoices with no booking keep the per-resident rule and are never billed twice', async () => {
  const org = await newOrg();
  const ids = await seedResident(org, { price: '3000.00' });
  await withMigratorClient((c) =>
    c.query(
      `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, issued_at, updated_at)
       VALUES ($1,$2,$3,NULL,'INV-2097-0001',$4,$4,3000,$4,'ISSUED',now(),now())`,
      [randomUUID(), org.orgId, ids.resident, `${monthStr}-01`],
    ),
  );
  const run = await post(org, '/finance/invoices/generate-monthly', {
    month: monthStr,
    issue: false,
  }).expect(201);
  assert.equal(run.body.created, 0, 'the legacy invoice already bills this resident for the month');
  assert.equal(run.body.skippedExisting, 1);
  const draft = await draftReq(org, ids.resident, ids.booking);
  assert.equal(draft.status, 409);
  assert.match(String(draft.body.message), /without a booking/i);
  // two active legacy invoices for one resident-month are refused by the database
  await assert.rejects(
    rolledBack((c) =>
      c.query(
        `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, issued_at, updated_at)
         VALUES ($1,$2,$3,NULL,'INV-2097-0002',$4,$4,3000,$4,'ISSUED',now(),now())`,
        [randomUUID(), org.orgId, ids.resident, `${monthStr}-01`],
      ),
    ),
    (e: any) => e.code === '23505' && e.constraint === 'invoices_active_resident_period_legacy_key',
  );
});

// ------------------------------------------------------------------------------- fixture hygiene (keep this LAST)

test('fixture hygiene: no test of this run left ledger drift, contradictions or an unexplained void-less invoice', async () => {
  const orgs = [...createdOrgs];
  assert.ok(orgs.length > 0);
  const rows = await sqlRows(
    `WITH live AS (
       SELECT p.invoice_id, sum(p.amount) cash FROM payments p
        WHERE NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id) GROUP BY 1)
     SELECT
       count(*) FILTER (WHERE i.paid_amount <> coalesce(live.cash, 0) - i.adjustment_total) AS drift,
       count(*) FILTER (WHERE i.status NOT IN ('DRAFT','CANCELLED') AND NOT (
            (i.status = 'PAID' AND i.paid_amount = i.amount)
         OR (i.status = 'PARTIALLY_PAID' AND i.paid_amount < i.amount AND i.paid_amount + i.adjustment_total > 0)
         OR (i.status = 'ISSUED' AND i.paid_amount < i.amount AND i.paid_amount + i.adjustment_total <= 0)
         OR (i.status = 'OVERDUE' AND i.paid_amount < i.amount))) AS contradicting,
       count(*) FILTER (WHERE i.status = 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM invoice_voids v WHERE v.invoice_id = i.id)
                          AND i.organization_id <> ALL($2::uuid[])) AS unexplained_void_less
       FROM invoices i LEFT JOIN live ON live.invoice_id = i.id
      WHERE i.organization_id = ANY($1::uuid[])`,
    [orgs, [...legacyFixtureOrgs]],
  );
  assert.deepEqual(
    {
      drift: Number(rows[0].drift),
      contradicting: Number(rows[0].contradicting),
      unexplained: Number(rows[0].unexplained_void_less),
    },
    { drift: 0, contradicting: 0, unexplained: 0 },
    'a test left a payment the invoice does not know about, a contradictory invoice, or a void-less cancelled invoice: wrap its direct SQL in rolledBack()',
  );
});
