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

async function newOrg(role: 'OWNER' | 'PROPERTY_MANAGER' = 'OWNER'): Promise<Org> {
  const orgId = randomUUID();
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
      `INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,$3,'Resident',now())`,
      [ids.resident, org.orgId, opts.name ?? `Res${ids.resident.slice(0, 6)}`],
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
        checkInAt,
        new Date(checkInAt.getTime() + 365 * 86_400_000),
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
function get(org: Org, path: string) {
  return server.get(`/api/v1${path}`).set('Cookie', `${org.cookies.session}; ${org.cookies.csrf}`);
}

/** Creates and issues a one-off invoice for a freshly seeded resident. */
async function issuedInvoice(
  org: Org,
  price = '100.00',
  dueDate: string | null = future,
  month = monthStr,
) {
  const ids = await seedResident(org, { price });
  const created = await post(org, '/finance/invoices', {
    residentId: ids.resident,
    bookingId: ids.booking,
    month,
    dueDate,
  }).expect(201);
  await post(org, `/finance/invoices/${created.body.id}/issue`, {}).expect(201);
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
  await post(org, '/finance/invoices', { residentId: ids.resident, month: monthStr }).expect(400); // no amount, no booking
  await post(org, '/finance/invoices', {
    residentId: ids.resident,
    amount: '10.005',
    month: monthStr,
  }).expect(400);
  await post(org, '/finance/invoices', {
    residentId: ids.resident,
    amount: '10',
    month: '2026-13',
  }).expect(400);
  await post(org, '/finance/invoices', {
    residentId: ids.resident,
    amount: '10',
    month: monthStr,
    dueDate: '2000-01-01',
  }).expect(400);
  await post(org, '/finance/invoices', {
    residentId: 'nope',
    amount: '10',
    month: monthStr,
  }).expect(400);
  await post(org, '/finance/invoices', {
    residentId: ids.resident,
    amount: '10',
    month: '2099-01',
  }).expect(400);
  await get(org, '/finance/invoices/not-a-uuid').expect(400);
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
        `INSERT INTO invoices (id, organization_id, resident_id, number, period_start, period_end, amount, due_date, updated_at)
         VALUES ($1,$2,$3,'INV-2099-9999',$4,$4,10,$4,now())`,
        [randomUUID(), org.orgId, ids.resident, monthStart],
      ),
    ),
    (e: any) => e.code === '23505',
    'database unique index must reject a second invoice for the same org/resident/period',
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

test('invoice: ineligible residents are excluded from generation', async () => {
  const org = await newOrg();
  const eligible = await seedResident(org);
  await seedResident(org, { bookingStatus: 'CANCELLED' });
  await seedResident(org, { admissionStatus: 'PENDING' });
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
  // A manual invoice against a cancelled booking is also refused.
  const cancelled = await seedResident(org, { bookingStatus: 'CANCELLED' });
  await post(org, '/finance/invoices', {
    residentId: cancelled.resident,
    bookingId: cancelled.booking,
    month: monthStr,
  }).expect(400);
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
  await withMigratorClient((c) =>
    c.query(`UPDATE invoices SET status = 'CANCELLED' WHERE id = $1`, [draft.body.id]),
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
    // A key-less payment (inserted directly as the owner) lets the composite FK fire before the
    // unique index on payment_id could.
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
    amount: '10',
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
