/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies and pg rows are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { loadRuntimeConfig } from '../../src/config.js';
import { MockSmsProvider } from '../../src/resident-auth/sms/mock-sms.provider.js';
import { SMS_PROVIDER } from '../../src/resident-auth/sms/sms.js';
import { seedStay } from './helpers/billing-fixtures.js';
import { withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { hashTestPassword, TEST_PASSWORD } from './helpers/fixtures.js';

// Resident self-service APIs (read-only) over real HTTP against the disposable PostgreSQL. Data is created through the same owner
// workflows the product uses (issue, pay, reverse, credit, void), and every resident figure is cross-checked against the owner API.
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.RESIDENT_WEB_ORIGIN = 'http://localhost:5174';
process.env.RESIDENT_OTP_SECRET = 'integration-test-otp-secret-0123456789abcdef';
process.env.RESIDENT_SMS_PROVIDER = 'mock';
process.env.TRUST_PROXY_HOPS = '1';
requireTestDatabaseUrl();

const OWNER_ORIGIN = 'http://localhost:5173';
const RESIDENT_ORIGIN = 'http://localhost:5174';
const ME_ROUTES = ['/me', '/me/stay', '/me/rent-summary', '/me/invoices', '/me/payments'];
let app: any;
let server: ReturnType<typeof request>;
let sms: MockSmsProvider;
let passwordHash: string;

const sql = <T = any>(query: string, params: unknown[] = []): Promise<T[]> =>
  withMigratorClient(async (c) => (await c.query(query, params as never[])).rows as T[]);

// ------------------------------------------------------------------ dates (billing months relative to now)
const now = new Date();
const Y = now.getUTCFullYear();
const M = now.getUTCMonth() + 1;
const monthOf = (offset: number) =>
  new Date(Date.UTC(Y, M - 1 + offset, 1)).toISOString().slice(0, 7);
const m0 = monthOf(0);
const m1 = monthOf(-1);
const m2 = monthOf(-2);
const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ owner side helpers
interface Owner {
  orgId: string;
  userId: string;
  propertyId: string;
  roomId: string;
  email: string;
  cookie: string;
  csrf: string;
}
let phoneSeq = 0;
const newPhone = () =>
  `+9199${String(10000000 + Math.floor(Math.random() * 8999999) + phoneSeq++ * 13)
    .padStart(8, '0')
    .slice(-8)}`;

async function newOrg(name: string): Promise<Owner> {
  const orgId = randomUUID(),
    userId = randomUUID(),
    propertyId = randomUUID(),
    floorId = randomUUID(),
    roomId = randomUUID();
  const email = `self-${randomUUID()}@nook.test.invalid`;
  await sql(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
    orgId,
    `${name} ${orgId.slice(0, 6)}`,
  ]);
  await sql(
    `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,'Owner',now())`,
    [userId, email, passwordHash],
  );
  await sql(
    `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'OWNER','ACTIVE')`,
    [randomUUID(), orgId, userId],
  );
  await sql(
    `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'P',now())`,
    [propertyId, orgId, `P-${propertyId.slice(0, 8)}`],
  );
  await sql(
    `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,'F',0,now())`,
    [floorId, orgId, propertyId],
  );
  await sql(
    `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at) VALUES ($1,$2,$3,$4,'R',now())`,
    [roomId, orgId, propertyId, floorId],
  );
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', OWNER_ORIGIN)
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  const c = Object.fromEntries(
    (res.headers['set-cookie'] as unknown as string[]).map((x) => x.split(';')[0]!.split('=')),
  );
  const cookie = `nook_session=${c.nook_session}; nook_csrf=${c.nook_csrf}`;
  const csrf = (await server.get('/api/v1/auth/csrf').set('Cookie', cookie)).body.data
    .csrfToken as string;
  return { orgId, userId, propertyId, roomId, email, cookie, csrf };
}
const oPost = (o: Owner, path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  server
    .post(`/api/v1${path}`)
    .set('Origin', OWNER_ORIGIN)
    .set(headers)
    .set('Cookie', o.cookie)
    .set('X-CSRF-Token', o.csrf)
    .send(body as object);
const oGet = (o: Owner, path: string) => server.get(`/api/v1${path}`).set('Cookie', o.cookie);

async function invoiceFor(
  o: Owner,
  residentId: string,
  bookingId: string,
  month: string,
  opts: { legacyDue?: boolean; issue?: boolean; notes?: string } = {},
): Promise<string> {
  const created = await oPost(o, '/finance/invoices', {
    residentId,
    bookingId,
    month,
    ...(opts.legacyDue ? {} : { dueDate: future }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  if (opts.issue === false) return created.body.id;
  if (opts.legacyDue)
    await sql(
      `UPDATE invoices SET status = 'ISSUED', issued_at = now(), due_date = $2 WHERE id = $1`,
      [created.body.id, `${month}-05`],
    );
  else assert.equal((await oPost(o, `/finance/invoices/${created.body.id}/issue`, {})).status, 201);
  return created.body.id;
}
async function pay(o: Owner, invoiceId: string, amount: string, extra: object): Promise<string> {
  const res = await oPost(
    o,
    '/finance/payments',
    { invoiceId, amount, ...extra },
    { 'Idempotency-Key': randomUUID() },
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.payment.id;
}

// ------------------------------------------------------------------ resident side helpers
interface Res {
  cookie: string;
  csrf: string;
}
async function provisionAndLogin(
  o: Owner,
  residentId: string,
  phone = newPhone(),
): Promise<{ accountId: string; phone: string; session: Res }> {
  const created = await oPost(o, '/resident-accounts', { residentId, phone });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { accountId: created.body.data.id, phone, session: await loginResident(phone) };
}
async function loginResident(phone: string): Promise<Res> {
  await sql('DELETE FROM resident_auth_throttles');
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  assert.equal(
    (
      await server
        .post('/api/v1/resident-auth/otp/request')
        .set('Origin', RESIDENT_ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({ phone })
    ).status,
    200,
  );
  const res = await server
    .post('/api/v1/resident-auth/otp/verify')
    .set('Origin', RESIDENT_ORIGIN)
    .set('X-Forwarded-For', ip)
    .send({ phone, code: sms.lastCodeFor(phone) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const c = Object.fromEntries(
    (res.headers['set-cookie'] as unknown as string[]).map((x) => x.split(';')[0]!.split('=')),
  );
  return {
    cookie: `nook_resident_session=${c.nook_resident_session}; nook_resident_csrf=${c.nook_resident_csrf}`,
    csrf: '',
  };
}
const me = (s: Res | null, path: string) => {
  const r = server.get(`/api/v1${path}`);
  return s ? r.set('Cookie', s.cookie) : r;
};

// ------------------------------------------------------------------ the world
interface World {
  A: Owner;
  B: Owner;
  r1: {
    residentId: string;
    bookingId: string;
    phone: string;
    accountId: string;
    session: Res;
    invoices: { m2: string; m1: string; m0: string };
    payments: { full: string; part: string; reversed: string };
  };
  r2: {
    residentId: string;
    phone: string;
    accountId: string;
    session: Res;
    m0: string;
    m1Void: string;
    m2Draft: string;
    payment: string;
  };
  rNone: { residentId: string; session: Res };
  rUpcoming: { residentId: string; session: Res };
  rDone: { residentId: string; session: Res };
  rb: { residentId: string; phone: string; session: Res; invoice: string; payment: string };
}
let W: World;

const SECRETS = [
  'INTERNAL-NOTE-SECRET',
  'INTERNAL-PAYMENT-NOTE',
  'INTERNAL-REVERSAL-REASON',
  'INTERNAL-ADJUSTMENT-REASON',
  'INTERNAL-VOID-REASON',
  'secret-doc',
  '1 Secret Street',
  'secret.person@example.invalid',
  'Emergency Contact Secret',
  'UPI-REF-9876543210',
  'CASH-0001-ABCD',
];
const FORBIDDEN_KEYS = [
  'organizationId',
  'residentId',
  'accountId',
  'userId',
  'passwordHash',
  'password_hash',
  'notes',
  'adjustmentTotal',
  'adjustments',
  'void',
  'voids',
  'reversal',
  'reversals',
  'reason',
  'correctsPaymentId',
  'creditTotalAtPayment',
  'balanceSource',
  'storedStatus',
  'documentUrl',
  'documentMetadata',
  'documentVerificationStatus',
  'address',
  'dateOfBirth',
  'email',
  'emergencyContactName',
  'emergencyContactPhone',
  'tokenHash',
  'codeHash',
  'createdBy',
  'reversedBy',
  'actor',
  'metadata',
  'cashReceived',
  'isOverdue',
  'daysOverdue',
  'idempotencyKey',
];
function keys(v: unknown, out = new Set<string>()) {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keys(x, out);
    }
  return out;
}
const collected: unknown[] = [];
function expectClean(body: unknown, extraForbidden: string[] = []) {
  collected.push(body);
  const text = JSON.stringify(body);
  for (const k of keys(body))
    assert.ok(!FORBIDDEN_KEYS.includes(k), `forbidden key "${k}" in ${text.slice(0, 160)}`);
  for (const s of [...SECRETS, ...extraForbidden])
    assert.ok(!text.includes(s), `forbidden value "${s}" in ${text.slice(0, 160)}`);
}

test.before(async () => {
  passwordHash = await hashTestPassword();
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: true });
  configureApp(app, loadRuntimeConfig());
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${app.getHttpServer().address().port}`);
  sms = app.get(SMS_PROVIDER) as MockSmsProvider;
  await sql('DELETE FROM login_throttles');

  const A = await newOrg('Self A'),
    B = await newOrg('Self B');
  // ---- r1: current stay since the start of month-2, three issued invoices (paid / part-paid + reversed payment / unpaid)
  const stay1 = await seedStay(A, {
    name: 'Alice',
    price: '8000.00',
    checkInAt: new Date(Date.UTC(Y, M - 3, 2)),
  });
  await sql(
    `UPDATE residents SET email='secret.person@example.invalid', address='1 Secret Street', document_url='https://docs.invalid/secret-doc', emergency_contact_name='Emergency Contact Secret', date_of_birth='1999-01-01', phone='+919000000001' WHERE id=$1`,
    [stay1.resident],
  );
  const i2 = await invoiceFor(A, stay1.resident, stay1.booking, m2, { legacyDue: true });
  const i1 = await invoiceFor(A, stay1.resident, stay1.booking, m1, { legacyDue: true });
  const i0 = await invoiceFor(A, stay1.resident, stay1.booking, m0, {
    notes: 'INTERNAL-NOTE-SECRET',
  });
  const full = await pay(A, i2, '8000.00', {
    method: 'CASH',
    reference: 'CASH-0001-ABCD',
    notes: 'INTERNAL-PAYMENT-NOTE',
    receivedAt: new Date(Date.now() - 50 * 86_400_000).toISOString(),
  });
  const part = await pay(A, i1, '3000.00', {
    method: 'UPI',
    reference: 'UPI-REF-9876543210',
    notes: 'INTERNAL-PAYMENT-NOTE',
    receivedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
  });
  const reversed = await pay(A, i1, '1000.00', {
    method: 'CASH',
    reference: 'CASH-0001-ABCD',
    receivedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  });
  assert.equal(
    (
      await oPost(A, `/finance/payments/${reversed}/reverse`, {
        reason: 'INTERNAL-REVERSAL-REASON',
      })
    ).status,
    201,
  );
  const p1 = await provisionAndLogin(A, stay1.resident);
  // ---- r2 (same organization): a draft, a voided invoice and a credited invoice, none of which r1 may see
  const stay2 = await seedStay(A, {
    name: 'Bob',
    price: '6000.00',
    checkInAt: new Date(Date.UTC(Y, M - 3, 2)),
  });
  const d2 = await invoiceFor(A, stay2.resident, stay2.booking, m2, { issue: false });
  const v1 = await invoiceFor(A, stay2.resident, stay2.booking, m1, { legacyDue: true });
  const voided = await oPost(A, `/finance/invoices/${v1}/void`, { reason: 'INTERNAL-VOID-REASON' });
  assert.equal(voided.status, 201, JSON.stringify(voided.body));
  const c0 = await invoiceFor(A, stay2.resident, stay2.booking, m0);
  const adj = await oPost(A, `/finance/invoices/${c0}/adjustments`, {
    amount: '-500.00',
    reason: 'INTERNAL-ADJUSTMENT-REASON',
  });
  assert.equal(adj.status, 201, JSON.stringify(adj.body));
  const p2pay = await pay(A, c0, '1000.00', {
    method: 'UPI',
    reference: 'BOB-OWN-REF-5555',
    receivedAt: new Date().toISOString(),
  });
  const p2 = await provisionAndLogin(A, stay2.resident);
  // ---- residents with no stay, an upcoming booking and a completed stay
  const none = await sql(
    `INSERT INTO residents (organization_id, first_name, last_name, status, updated_at) VALUES ($1,'Nina','NoStay','ACTIVE',now()) RETURNING id`,
    [A.orgId],
  );
  const up = await sql(
    `INSERT INTO residents (organization_id, first_name, last_name, status, updated_at) VALUES ($1,'Uma','Upcoming','ACTIVE',now()) RETURNING id`,
    [A.orgId],
  );
  const bedUp = (
    await sql(
      `INSERT INTO beds (organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,'UP-1',now()) RETURNING id`,
      [A.orgId, A.propertyId, A.roomId],
    )
  )[0].id;
  await sql(
    `INSERT INTO bookings (organization_id, resident_id, bed_id, start_date, end_date, monthly_price, status, updated_at) VALUES ($1,$2,$3,$4,$5,'9000.00','CONFIRMED',now())`,
    [
      A.orgId,
      up[0].id,
      bedUp,
      new Date(Date.now() + 20 * 86_400_000),
      new Date(Date.now() + 200 * 86_400_000),
    ],
  );
  const done = await seedStay(A, {
    name: 'Dan',
    price: '5000.00',
    checkInAt: new Date(Date.now() - 120 * 86_400_000),
    bookingEnd: new Date(Date.now() - 20 * 86_400_000),
    checkedOutAt: new Date(Date.now() - 25 * 86_400_000),
  });
  // ---- organization B: same prices, its own invoice numbering (the numbers repeat across organizations on purpose)
  const stayB = await seedStay(B, {
    name: 'Alice',
    price: '8000.00',
    checkInAt: new Date(Date.UTC(Y, M - 3, 2)),
  });
  const ib = await invoiceFor(B, stayB.resident, stayB.booking, m0);
  const pb = await pay(B, ib, '3000.00', {
    method: 'UPI',
    reference: 'UPI-REF-9876543210',
    receivedAt: new Date().toISOString(),
  });
  const rb = await provisionAndLogin(B, stayB.resident);
  const sNone = await provisionAndLogin(A, none[0].id),
    sUp = await provisionAndLogin(A, up[0].id),
    sDone = await provisionAndLogin(A, done.resident);
  W = {
    A,
    B,
    r1: {
      residentId: stay1.resident,
      bookingId: stay1.booking,
      phone: p1.phone,
      accountId: p1.accountId,
      session: p1.session,
      invoices: { m2: i2, m1: i1, m0: i0 },
      payments: { full, part, reversed },
    },
    r2: {
      residentId: stay2.resident,
      phone: p2.phone,
      accountId: p2.accountId,
      session: p2.session,
      m0: c0,
      m1Void: v1,
      m2Draft: d2,
      payment: p2pay,
    },
    rNone: { residentId: none[0].id, session: sNone.session },
    rUpcoming: { residentId: up[0].id, session: sUp.session },
    rDone: { residentId: done.resident, session: sDone.session },
    rb: {
      residentId: stayB.resident,
      phone: rb.phone,
      session: rb.session,
      invoice: ib,
      payment: pb,
    },
  };
});
test.after(async () => {
  await app.close();
});

// ------------------------------------------------------------------ 1. profile
test('profile: a resident reads their own profile; the phone is masked and no contact, document or internal field is returned', async () => {
  const res = await me(W.r1.session, '/me');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const d = res.body.data;
  assert.deepEqual(Object.keys(d).sort(), [
    'accountStatus',
    'displayName',
    'firstName',
    'lastName',
    'memberSince',
    'organizationName',
    'phone',
    'residentStatus',
  ]);
  assert.equal(d.displayName, 'Alice Resident');
  assert.equal(d.accountStatus, 'ACTIVE');
  assert.equal(d.residentStatus, 'ACTIVE');
  assert.equal(d.phone, `+91******${W.r1.phone.slice(-4)}`);
  assert.ok(d.organizationName.startsWith('Self A'));
  expectClean(res.body, [W.r1.phone, W.r1.phone.slice(3), '9000000001', '1999-01-01']);
});

// ------------------------------------------------------------------ 2-3. stay
test('stay: a resident reads their current stay from the existing allocation logic (hostel, room, bed, dates, rent)', async () => {
  const res = await me(W.r1.session, '/me/stay');
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.status, 'CURRENT');
  assert.deepEqual(Object.keys(d.current).sort(), [
    'bedNumber',
    'checkInDate',
    'expectedCheckOutDate',
    'hostelName',
    'monthlyRent',
    'organizationName',
    'roomNumber',
    'stayStatus',
  ]);
  assert.equal(d.current.hostelName, 'P');
  assert.equal(d.current.roomNumber, 'R');
  assert.match(d.current.bedNumber, /^B-/);
  assert.equal(d.current.monthlyRent, '8000.00');
  assert.equal(d.current.stayStatus, 'ACTIVE');
  // the owner-side summary for the same resident says the same thing (same source of truth)
  const owner = await oGet(W.A, `/residents/${W.r1.residentId}/stay-summary`);
  assert.equal(owner.status, 200);
  assert.equal(owner.body.currentStayStatus, 'ACTIVE');
  assert.equal(d.current.checkInDate, owner.body.currentStay.activeCheckIn.checkInAt);
  assert.equal(d.current.expectedCheckOutDate, owner.body.currentStay.booking.endDate);
  assert.equal(d.current.roomNumber, owner.body.currentStay.booking.roomLabel);
  assert.equal(d.current.bedNumber, owner.body.currentStay.booking.bedLabel);
  assert.deepEqual(d.upcoming, []);
  assert.equal(d.lastStay, null);
  expectClean(res.body);
});

test('stay: no stay, an upcoming booking and a completed stay each give a safe, explicit answer', async () => {
  const none = await me(W.rNone.session, '/me/stay');
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, {
    data: { status: 'NONE', current: null, upcoming: [], lastStay: null },
  });
  const up = (await me(W.rUpcoming.session, '/me/stay')).body.data;
  assert.equal(up.status, 'UPCOMING');
  assert.equal(up.current, null);
  assert.equal(up.upcoming.length, 1);
  assert.equal(up.upcoming[0].stage, 'BOOKED');
  assert.equal(up.upcoming[0].monthlyRent, '9000.00');
  assert.equal(up.upcoming[0].bedNumber, 'UP-1');
  const done = (await me(W.rDone.session, '/me/stay')).body.data;
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.current, null);
  assert.ok(done.lastStay.checkedOutAt);
  assert.deepEqual(Object.keys(done.lastStay), ['checkedOutAt']);
  for (const r of [none.body, up, done]) expectClean(r);
});

// ------------------------------------------------------------------ 4. rent summary
test('rent summary: totals and statuses agree with the owner outstanding calculation; a resident without invoices sees zeros', async () => {
  const res = await me(W.r1.session, '/me/rent-summary');
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.deepEqual(d, {
    totalInvoiced: '24000.00',
    totalPaid: '11000.00',
    outstanding: '13000.00',
    overdue: '5000.00',
    nextDueDate: future,
    status: 'OVERDUE',
    invoiceCount: 3,
  });
  const owner = await oGet(W.A, `/finance/outstanding?residentId=${W.r1.residentId}`);
  assert.equal(owner.status, 200);
  assert.equal(d.outstanding, owner.body.totals.outstandingAmount);
  assert.equal(d.overdue, owner.body.totals.overdueAmount);
  const none = await me(W.rNone.session, '/me/rent-summary');
  assert.deepEqual(none.body.data, {
    totalInvoiced: '0.00',
    totalPaid: '0.00',
    outstanding: '0.00',
    overdue: '0.00',
    nextDueDate: null,
    status: 'NO_INVOICES',
    invoiceCount: 0,
  });
  // r2: a draft and a voided invoice are not counted; the credit is part of what the owner side calls paid
  const r2 = await me(W.r2.session, '/me/rent-summary');
  const ownerInvoice = (await oGet(W.A, `/finance/invoices/${W.r2.m0}`)).body;
  assert.equal(r2.body.data.invoiceCount, 1);
  assert.equal(r2.body.data.totalInvoiced, '6000.00');
  assert.equal(r2.body.data.outstanding, ownerInvoice.balance);
  for (const r of [res.body, none.body, r2.body]) expectClean(r);
});

// ------------------------------------------------------------------ 5-6. invoices
test('invoices: a resident lists only their own visible invoices, newest period first, and each figure equals the owner view', async () => {
  const res = await me(W.r1.session, '/me/invoices');
  assert.equal(res.status, 200);
  const { items, pagination } = res.body.data;
  assert.deepEqual(pagination, { page: 1, limit: 20, total: 3, totalPages: 1 });
  assert.deepEqual(
    items.map((i: any) => i.id),
    [W.r1.invoices.m0, W.r1.invoices.m1, W.r1.invoices.m2],
  );
  assert.deepEqual(Object.keys(items[0]).sort(), [
    'dueDate',
    'id',
    'issuedAt',
    'number',
    'outstandingAmount',
    'paidAmount',
    'periodEnd',
    'periodStart',
    'status',
    'totalAmount',
  ]);
  assert.deepEqual(
    items.map((i: any) => i.status),
    ['ISSUED', 'OVERDUE', 'PAID'],
  );
  for (const item of items) {
    const o = (await oGet(W.A, `/finance/invoices/${item.id}`)).body;
    assert.equal(item.number, o.number);
    assert.equal(item.totalAmount, o.amount);
    assert.equal(item.paidAmount, o.paidAmount);
    assert.equal(item.outstandingAmount, o.balance);
    assert.equal(item.status, o.status);
    assert.equal(item.dueDate, o.dueDate);
    assert.equal(item.periodStart, o.periodStart);
  }
  expectClean(res.body);
});

test("invoices: drafts, voided invoices and other residents' invoices are not listed (same organization)", async () => {
  const r2 = (await me(W.r2.session, '/me/invoices')).body.data;
  assert.deepEqual(
    r2.items.map((i: any) => i.id),
    [W.r2.m0],
    'only the issued invoice: the draft and the voided one are hidden',
  );
  const all1 = (await me(W.r1.session, '/me/invoices')).body.data.items.map((i: any) => i.id);
  for (const hidden of [W.r2.m0, W.r2.m1Void, W.r2.m2Draft]) assert.ok(!all1.includes(hidden));
  for (const hidden of [W.r2.m1Void, W.r2.m2Draft])
    assert.equal(
      (await me(W.r2.session, `/me/invoices/${hidden}`)).status,
      404,
      'hidden even from their own resident',
    );
  expectClean(r2);
});

test('invoice detail: one own invoice with its payments (masked reference, COMPLETED or REVERSED), no adjustment, note or staff data', async () => {
  const res = await me(W.r1.session, `/me/invoices/${W.r1.invoices.m1}`);
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.id, W.r1.invoices.m1);
  assert.equal(d.totalAmount, '8000.00');
  assert.equal(d.paidAmount, '3000.00');
  assert.equal(d.outstandingAmount, '5000.00');
  assert.equal(d.status, 'OVERDUE');
  assert.deepEqual(
    d.payments.map((p: any) => [p.amount, p.method, p.reference, p.status]),
    [
      ['3000.00', 'UPI', '****3210', 'COMPLETED'],
      ['1000.00', 'CASH', '****ABCD', 'REVERSED'],
    ],
  );
  assert.deepEqual(Object.keys(d.payments[0]).sort(), [
    'amount',
    'id',
    'method',
    'paidAt',
    'receiptNumber',
    'reference',
    'status',
  ]);
  expectClean(res.body);
  const credited = (await me(W.r2.session, `/me/invoices/${W.r2.m0}`)).body.data;
  const owner = (await oGet(W.A, `/finance/invoices/${W.r2.m0}`)).body;
  assert.equal(credited.outstandingAmount, owner.balance);
  assert.equal(credited.paidAmount, owner.paidAmount);
  expectClean(credited);
});

// ------------------------------------------------------------------ 7-9. isolation
test("isolation: another resident's invoice, another organization's invoice, an unknown id and a malformed id are all refused alike", async () => {
  const notMine = [
    W.r2.m0,
    W.rb.invoice,
    randomUUID(),
    W.r1.payments.full /* a payment id used as an invoice id */,
  ];
  for (const id of notMine) {
    const res = await me(W.r1.session, `/me/invoices/${id}`);
    assert.equal(res.status, 404, id);
    assert.deepEqual(
      res.body,
      { code: 'NOT_FOUND' },
      'identical to a record that does not exist: no existence oracle',
    );
  }
  const bad = await me(W.r1.session, '/me/invoices/not-a-uuid');
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { code: 'INVALID_ID' });
  const reverse = await me(W.r2.session, `/me/invoices/${W.r1.invoices.m1}`);
  assert.equal(reverse.status, 404, 'and the other way round');
});

test("isolation: resident A cannot reach resident B's profile, stay, invoices or receipts, by id, query, header or body tricks", async () => {
  const bob = W.r2.residentId,
    bobAccount = W.r2.accountId;
  for (const path of [
    `/me?residentId=${bob}`,
    `/me/stay?residentId=${bob}&organizationId=${W.A.orgId}`,
    `/me/invoices?residentId=${bob}`,
    `/me/payments?accountId=${bobAccount}`,
    `/me/rent-summary?residentId=${bob}`,
  ]) {
    const res = await server
      .get(`/api/v1${path}`)
      .set('Cookie', W.r1.session.cookie)
      .set('X-Resident-Id', bob)
      .set('X-Organization-Id', W.B.orgId);
    assert.equal(res.status, 200, path);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('Bob'), `${path} leaked another resident`);
  }
  assert.equal(
    (await server.get('/api/v1/me').set('Cookie', W.r1.session.cookie).set('X-Resident-Id', bob))
      .body.data.displayName,
    'Alice Resident',
  );
  for (const path of [`/me/${bob}`, `/me/${bob}/stay`, `/residents/${bob}`, `/me/stay/${bob}`])
    assert.ok([403, 404].includes((await me(W.r1.session, path)).status), path);
  assert.equal((await me(W.r2.session, '/me')).body.data.displayName, 'Bob Resident');
  assert.equal((await me(W.r1.session, `/me/receipts/${W.r2.m0}`)).status, 404);
  // a payment of another resident in the SAME organization: invisible to r1, readable by its owner
  const sameOrg = await me(W.r1.session, `/me/receipts/${W.r2.payment}`);
  assert.equal(sameOrg.status, 404);
  assert.deepEqual(sameOrg.body, { code: 'NOT_FOUND' });
  assert.equal((await me(W.r2.session, `/me/receipts/${W.r2.payment}`)).status, 200);
  const r1Pay = (await me(W.r1.session, '/me/payments?limit=50')).body.data.items;
  assert.ok(!r1Pay.some((x: any) => x.id === W.r2.payment));
  const r2Pay = (await me(W.r2.session, '/me/payments')).body.data.items;
  assert.equal(r2Pay[0].id, W.r2.payment);
  assert.equal(r2Pay[0].reference, '****5555');
});

test('cross-organization: each resident sees only their organization; identical invoice numbers in two organizations never mix', async () => {
  const a = (await me(W.r1.session, '/me/invoices')).body.data.items;
  const b = (await me(W.rb.session, '/me/invoices')).body.data.items;
  assert.equal(b.length, 1);
  assert.equal(b[0].id, W.rb.invoice);
  assert.ok(
    a.some((i: any) => i.number === b[0].number),
    'the same invoice number exists in both organizations',
  );
  assert.ok(
    !a.some((i: any) => i.id === b[0].id) && !b.some((i: any) => a.some((x: any) => x.id === i.id)),
  );
  assert.ok((await me(W.rb.session, '/me')).body.data.organizationName.startsWith('Self B'));
  assert.ok((await me(W.r1.session, '/me')).body.data.organizationName.startsWith('Self A'));
  assert.equal((await me(W.rb.session, `/me/invoices/${W.r1.invoices.m1}`)).status, 404);
  assert.equal((await me(W.rb.session, `/me/receipts/${W.r1.payments.part}`)).status, 404);
  assert.equal((await me(W.rb.session, '/me/rent-summary')).body.data.totalInvoiced, '8000.00');
  assert.equal((await me(W.r1.session, '/me/rent-summary')).body.data.totalInvoiced, '24000.00');
});

// ------------------------------------------------------------------ payments and receipts
test('payments: own payment history only, newest first, with masked references, status and the related invoice', async () => {
  const res = await me(W.r1.session, '/me/payments');
  assert.equal(res.status, 200);
  const { items, pagination } = res.body.data;
  assert.equal(pagination.total, 3);
  assert.deepEqual(
    items.map((p: any) => p.id),
    [W.r1.payments.reversed, W.r1.payments.part, W.r1.payments.full],
  );
  assert.deepEqual(
    items.map((p: any) => p.status),
    ['REVERSED', 'COMPLETED', 'COMPLETED'],
  );
  assert.deepEqual(
    items.map((p: any) => p.reference),
    ['****ABCD', '****3210', '****ABCD'],
  );
  assert.deepEqual(items.map((p: any) => p.invoice.number).length, 3);
  assert.equal(items[1].invoice.id, W.r1.invoices.m1);
  assert.deepEqual(Object.keys(items[0]).sort(), [
    'amount',
    'id',
    'invoice',
    'method',
    'paidAt',
    'receiptNumber',
    'reference',
    'status',
  ]);
  assert.ok(!items.some((p: any) => p.id === W.rb.payment));
  assert.equal((await me(W.rb.session, '/me/payments')).body.data.items[0].id, W.rb.payment);
  assert.equal((await me(W.rNone.session, '/me/payments')).body.data.pagination.total, 0);
  expectClean(res.body);
});

test('receipts: a resident can read the receipt of their own payment (built by the existing receipt logic), reversed ones show REVERSED, others are 404', async () => {
  const ok = await me(W.r1.session, `/me/receipts/${W.r1.payments.part}`);
  assert.equal(ok.status, 200);
  const d = ok.body.data;
  assert.equal(d.receiptNumber, `RCPT-${W.r1.payments.part}`);
  assert.deepEqual(Object.keys(d).sort(), [
    'balanceAfterPayment',
    'invoice',
    'issuedBy',
    'issuedTo',
    'payment',
    'receiptNumber',
  ]);
  assert.equal(d.issuedTo, 'Alice Resident');
  assert.ok(d.issuedBy.startsWith('Self A'));
  assert.equal(d.payment.reference, '****3210');
  assert.equal(d.payment.amount, '3000.00');
  assert.equal(d.payment.status, 'COMPLETED');
  const owner = (
    await oGet(W.A, `/finance/invoices/${W.r1.invoices.m1}/receipt?paymentId=${W.r1.payments.part}`)
  ).body;
  assert.equal(d.balanceAfterPayment, owner.receipts[0].balanceAfterPayment);
  assert.equal(d.invoice.number, owner.invoice.number);
  assert.equal(
    (await me(W.r1.session, `/me/receipts/${W.r1.payments.reversed}`)).body.data.payment.status,
    'REVERSED',
  );
  for (const id of [W.rb.payment, randomUUID(), W.r1.invoices.m1])
    assert.equal((await me(W.r1.session, `/me/receipts/${id}`)).status, 404, id);
  assert.equal((await me(W.r1.session, '/me/receipts/nope')).status, 400);
  expectClean(ok.body);
});

// ------------------------------------------------------------------ 10-11. account state
test('suspension: a suspended resident is refused on every resident endpoint at once; reactivating needs a fresh sign-in', async () => {
  const stay = await seedStay(W.A, {
    name: 'Sam',
    price: '4000.00',
    checkInAt: new Date(Date.now() - 5 * 86_400_000),
  });
  const { accountId, phone, session } = await provisionAndLogin(W.A, stay.resident);
  for (const p of [...ME_ROUTES]) assert.equal((await me(session, p)).status, 200, p);
  assert.equal(
    (await oPost(W.A, `/resident-accounts/${accountId}/suspend`, { reason: 'test' })).status,
    200,
  );
  for (const p of [...ME_ROUTES, `/me/invoices/${randomUUID()}`, `/me/receipts/${randomUUID()}`]) {
    const r = await me(session, p);
    assert.equal(r.status, 401, p);
    assert.equal(r.body.code, 'UNAUTHENTICATED');
  }
  assert.equal((await oPost(W.A, `/resident-accounts/${accountId}/reactivate`, {})).status, 200);
  assert.equal((await me(session, '/me')).status, 401, 'the old session stays dead');
  assert.equal((await me(await loginResident(phone), '/me')).status, 200);
});

test('revocation: a revoked resident is refused everywhere and cannot sign in again', async () => {
  const stay = await seedStay(W.A, {
    name: 'Rae',
    price: '4000.00',
    checkInAt: new Date(Date.now() - 5 * 86_400_000),
  });
  const { accountId, phone, session } = await provisionAndLogin(W.A, stay.resident);
  assert.equal((await oPost(W.A, `/resident-accounts/${accountId}/revoke`, {})).status, 200);
  for (const p of ME_ROUTES) assert.equal((await me(session, p)).status, 401, p);
  sms.reset();
  await sql('DELETE FROM resident_auth_throttles');
  await server
    .post('/api/v1/resident-auth/otp/request')
    .set('Origin', RESIDENT_ORIGIN)
    .send({ phone });
  assert.equal(sms.outbox.length, 0, 'no code is sent to a revoked account');
});

test('resident status policy: only ACTIVE resident + ACTIVE account may use /me/*; INACTIVE and ARCHIVED lose access on the next request; sessions of others are unaffected', async () => {
  const everyRoute = (inv: string, pay: string) => [
    ...ME_ROUTES,
    '/me/invoices?limit=50',
    `/me/invoices/${inv}`,
    `/me/receipts/${pay}`,
  ];
  for (const state of ['INACTIVE', 'ARCHIVED'] as const) {
    const stay = await seedStay(W.A, {
      name: `Pol${state}`,
      price: '4000.00',
      checkInAt: new Date(Date.now() - 5 * 86_400_000),
    });
    const inv = await invoiceFor(W.A, stay.resident, stay.booking, m0);
    const paid = await pay(W.A, inv, '1000.00', {
      method: 'CASH',
      reference: 'CASH-7777-QQQQ',
      receivedAt: new Date().toISOString(),
    });
    const { session, phone } = await provisionAndLogin(W.A, stay.resident);
    // ACTIVE + ACTIVE: every endpoint answers
    for (const p of everyRoute(inv, paid))
      assert.equal((await me(session, p)).status, 200, `ACTIVE ${p}`);
    assert.equal((await me(session, '/me')).body.data.residentStatus, 'ACTIVE');

    await sql(`UPDATE residents SET status=$2 WHERE id=$1`, [stay.resident, state]);
    for (const p of everyRoute(inv, paid)) {
      const r = await me(session, p);
      assert.equal(r.status, 401, `${state} ${p}`);
      assert.deepEqual(
        r.body,
        { code: 'UNAUTHENTICATED' },
        `${state} ${p}: generic, no state revealed`,
      );
    }
    // back to ACTIVE: the old session stays dead (it was ended when first refused); a fresh sign-in works
    await sql(`UPDATE residents SET status='ACTIVE' WHERE id=$1`, [stay.resident]);
    assert.equal((await me(session, '/me')).status, 401, `${state}: no revival of the old session`);
    const fresh = await loginResident(phone);
    assert.equal(
      (await me(fresh, '/me')).status,
      200,
      `${state}: fresh sign-in after re-activation`,
    );
    // other residents, in the same and in another organization, were never affected
    for (const other of [W.r1.session, W.r2.session, W.rb.session])
      assert.equal((await me(other, '/me')).status, 200, `${state}: bystander`);
  }
  // suspended and revoked accounts stay refused regardless of the resident's status (covered end to end above and below)
});

// ------------------------------------------------------------------ 12-14. audiences and sessions
test('staff sessions cannot use resident endpoints; resident sessions cannot use owner endpoints', async () => {
  const everyRoute = [
    ...ME_ROUTES,
    `/me/invoices/${W.r1.invoices.m1}`,
    `/me/receipts/${W.r1.payments.part}`,
  ];
  for (const p of everyRoute) {
    const res = await server.get(`/api/v1${p}`).set('Cookie', W.A.cookie);
    assert.equal(res.status, 401, `owner session on ${p}`);
    assert.equal(res.body.code, 'UNAUTHENTICATED');
  }
  const ownerRoutes = [
    '/finance/invoices',
    `/finance/invoices/${W.r1.invoices.m1}`,
    `/finance/invoices/${W.r1.invoices.m1}/receipt`,
    '/finance/outstanding',
    `/residents/${W.r1.residentId}`,
    `/residents/${W.r1.residentId}/stay-summary`,
    '/residents',
    '/bookings',
    '/auth/me',
    '/resident-accounts',
  ];
  for (const p of ownerRoutes) {
    const res = await me(W.r1.session, p);
    assert.equal(res.status, 403, `resident session on ${p}`);
    assert.equal(res.body.code, 'INSUFFICIENT_ROLE');
  }
});

test('sessions: missing, malformed, revoked and expired sessions are refused on every resident endpoint', async () => {
  const stay = await seedStay(W.A, {
    name: 'Eve',
    price: '4000.00',
    checkInAt: new Date(Date.now() - 5 * 86_400_000),
  });
  const { session } = await provisionAndLogin(W.A, stay.resident);
  const sid = (
    await sql(
      `SELECT s.id FROM resident_sessions s JOIN resident_accounts a ON a.id = s.resident_account_id WHERE a.resident_id = $1 ORDER BY s.created_at DESC LIMIT 1`,
      [stay.resident],
    )
  )[0].id;
  const all = [...ME_ROUTES, `/me/invoices/${randomUUID()}`, `/me/receipts/${randomUUID()}`];
  for (const p of all) {
    assert.equal((await me(null, p)).status, 401, `no cookie ${p}`);
    assert.equal(
      (await me({ cookie: 'nook_resident_session=garbage', csrf: '' }, p)).status,
      401,
      `garbage ${p}`,
    );
    assert.equal(
      (await me({ cookie: 'nook_resident_session=', csrf: '' }, p)).status,
      401,
      `empty ${p}`,
    );
  }
  assert.equal((await me(session, '/me')).status, 200);
  await sql(
    `UPDATE resident_sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1`,
    [sid],
  );
  for (const p of all) assert.equal((await me(session, p)).status, 401, `idle-expired ${p}`);
  await sql(
    `UPDATE resident_sessions SET idle_expires_at = now() + interval '10 minutes', absolute_expires_at = now() - interval '1 second' WHERE id = $1`,
    [sid],
  );
  for (const p of all) assert.equal((await me(session, p)).status, 401, `absolute-expired ${p}`);
  await sql(
    `UPDATE resident_sessions SET absolute_expires_at = now() + interval '1 hour', revoked_at = now() WHERE id = $1`,
    [sid],
  );
  for (const p of all) assert.equal((await me(session, p)).status, 401, `revoked ${p}`);
});

// ------------------------------------------------------------------ 15. csrf / origin / verbs
test('CSRF, origin and CORS protections are intact, and there is no way to write through /me', async () => {
  // the resident sign-out still needs the resident origin and CSRF token
  const noCsrf = await server
    .post('/api/v1/resident-auth/logout')
    .set('Origin', RESIDENT_ORIGIN)
    .set('Cookie', W.r1.session.cookie);
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.code, 'INVALID_CSRF_TOKEN');
  assert.equal(
    (
      await server
        .post('/api/v1/resident-auth/logout')
        .set('Origin', OWNER_ORIGIN)
        .set('Cookie', W.r1.session.cookie)
        .set('X-CSRF-Token', 'x')
    ).body.code,
    'INVALID_ORIGIN',
  );
  // no mutation verb exists under /me (with or without a valid CSRF token and origin)
  const token = (
    await server
      .get('/api/v1/resident-auth/csrf')
      .set('Origin', RESIDENT_ORIGIN)
      .set('Cookie', W.r1.session.cookie)
  ).body.data.csrfToken;
  for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
    for (const p of [
      '/me',
      '/me/stay',
      '/me/invoices',
      `/me/invoices/${W.r1.invoices.m1}`,
      '/me/payments',
      `/me/receipts/${W.r1.payments.part}`,
      '/me/rent-summary',
    ]) {
      const send = (server as any)[verb].bind(server) as (url: string) => request.Test;
      const res = await send(`/api/v1${p}`)
        .set('Origin', RESIDENT_ORIGIN)
        .set('Cookie', W.r1.session.cookie)
        .set('X-CSRF-Token', token)
        .send({ amount: '1.00', status: 'PAID' });
      assert.ok([404, 405].includes(res.status), `${verb.toUpperCase()} ${p} -> ${res.status}`);
    }
  }
  // CORS: the resident origin may call /me, a stranger may not, and nothing is wildcarded
  const pre = (origin: string, path: string) =>
    server
      .options(`/api/v1${path}`)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET');
  const ok = await pre(RESIDENT_ORIGIN, '/me/invoices');
  assert.equal(ok.headers['access-control-allow-origin'], RESIDENT_ORIGIN);
  assert.equal(ok.headers['access-control-allow-credentials'], 'true');
  assert.equal(
    (await pre('http://evil.test', '/me/invoices')).headers['access-control-allow-origin'],
    undefined,
  );
  assert.equal(
    (await pre(RESIDENT_ORIGIN, '/finance/invoices')).headers['access-control-allow-origin'],
    undefined,
  );
  const real = await server
    .get('/api/v1/me')
    .set('Origin', RESIDENT_ORIGIN)
    .set('Cookie', W.r1.session.cookie);
  assert.equal(real.headers['access-control-allow-origin'], RESIDENT_ORIGIN);
  const foreign = await server
    .get('/api/v1/me')
    .set('Origin', 'http://evil.test')
    .set('Cookie', W.r1.session.cookie);
  assert.equal(
    foreign.headers['access-control-allow-origin'],
    undefined,
    'a foreign page cannot read the response',
  );
  // owner workflows keep their own origin check
  assert.equal(
    (
      await server
        .post('/api/v1/finance/payments')
        .set('Origin', RESIDENT_ORIGIN)
        .set('Cookie', W.A.cookie)
        .set('X-CSRF-Token', W.A.csrf)
        .send({})
    ).body.code,
    'INVALID_ORIGIN',
  );
});

// ------------------------------------------------------------------ 16. pagination
test("pagination: pages are strictly the resident's own records, stable and complete; bad parameters are refused, not widened", async () => {
  const seen: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const r = await me(W.r1.session, `/me/invoices?page=${page}&limit=1`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.pagination, { page, limit: 1, total: 3, totalPages: 3 });
    assert.equal(r.body.data.items.length, 1);
    seen.push(r.body.data.items[0].id);
  }
  assert.deepEqual(seen, [W.r1.invoices.m0, W.r1.invoices.m1, W.r1.invoices.m2]);
  assert.deepEqual((await me(W.r1.session, '/me/invoices?page=4&limit=1')).body.data.items, []);
  assert.deepEqual(
    (await me(W.r1.session, '/me/invoices?page=2&limit=2')).body.data.items.map((i: any) => i.id),
    [W.r1.invoices.m2],
  );
  const big = await me(W.r1.session, '/me/invoices?limit=50');
  assert.equal(
    big.body.data.items.length,
    3,
    "the largest page still holds only this resident's invoices",
  );
  const p = await me(W.r1.session, '/me/payments?page=1&limit=2');
  assert.deepEqual(p.body.data.pagination, { page: 1, limit: 2, total: 3, totalPages: 2 });
  for (const q of [
    'limit=51',
    'limit=0',
    'limit=-1',
    'limit=abc',
    'page=0',
    'page=1.5',
    'page=x',
    'limit=1e3',
    'page=99999999999',
  ]) {
    const r = await me(W.r1.session, `/me/invoices?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.code, 'INVALID_PAGINATION');
    assert.equal((await me(W.r1.session, `/me/payments?${q}`)).status, 400, `payments ${q}`);
  }
  assert.equal(
    (await me(W.r1.session, '/me/invoices?limit=1&limit=50')).status,
    400,
    'repeated parameters are refused',
  );
});

// ------------------------------------------------------------------ 17. sensitive fields
test('sensitive data: across every response for every seeded resident no forbidden key or secret value appears', async () => {
  const sessions = [
    W.r1.session,
    W.r2.session,
    W.rb.session,
    W.rNone.session,
    W.rUpcoming.session,
    W.rDone.session,
  ];
  let responses = 0;
  for (const s of sessions) {
    for (const p of [...ME_ROUTES, '/me/invoices?limit=50']) {
      const r = await me(s, p);
      assert.equal(r.status, 200, p);
      expectClean(r.body);
      responses++;
    }
    const inv = (await me(s, '/me/invoices?limit=50')).body.data.items;
    for (const i of inv) {
      const d = await me(s, `/me/invoices/${i.id}`);
      assert.equal(d.status, 200);
      expectClean(d.body);
      responses++;
    }
    const pay = (await me(s, '/me/payments?limit=50')).body.data.items;
    for (const x of pay) {
      const d = await me(s, `/me/receipts/${x.id}`);
      assert.equal(d.status, 200);
      expectClean(d.body);
      responses++;
    }
  }
  assert.ok(responses >= 40, `${responses} responses scanned`);
  // errors carry only a code, never a message with internals
  for (const r of [
    await me(W.r1.session, `/me/invoices/${randomUUID()}`),
    await me(W.r1.session, '/me/invoices/zzz'),
    await me(W.r1.session, '/me/invoices?limit=99'),
    await me(null, '/me'),
  ]) {
    assert.ok(
      Object.keys(r.body).every((k) =>
        ['code', 'field', 'statusCode', 'message', 'requestId'].includes(k),
      ),
      JSON.stringify(r.body),
    );
    expectClean(r.body);
  }
  // other residents' names never reach a resident
  for (const [s, other] of [
    [W.r1.session, 'Bob'],
    [W.r2.session, 'Alice'],
    [W.rb.session, 'Bob'],
  ] as const)
    assert.ok(!JSON.stringify((await me(s, '/me')).body).includes(other));
});

// ------------------------------------------------------------------ 18. nothing is written; owner workflows unchanged
test('read-only: every resident endpoint leaves the financial and domain records byte-identical, and owner views are unchanged', async () => {
  const tables = [
    'invoices',
    'payments',
    'payment_reversals',
    'invoice_adjustments',
    'invoice_voids',
    'payment_idempotency_keys',
    'bookings',
    'admissions',
    'check_ins',
    'check_outs',
    'stay_assignments',
    'transfers',
    'residents',
    'resident_accounts',
    'audit_events',
  ];
  const snapshot = async () => {
    const h = createHash('sha256');
    for (const t of tables)
      h.update(
        t +
          JSON.stringify(
            (
              await sql(
                `SELECT to_jsonb(t) r FROM ${t} t WHERE to_jsonb(t)::text NOT LIKE '%last_login_at%' OR true ORDER BY to_jsonb(t)::text COLLATE "C"`,
              )
            ).map((x: any) => {
              const r = { ...x.r };
              delete r.last_login_at;
              delete r.updated_at;
              return r;
            }),
          ),
      );
    return h.digest('hex');
  };
  const ownerView = async () =>
    JSON.stringify([
      (await oGet(W.A, '/finance/invoices?limit=100')).body,
      (await oGet(W.A, '/finance/outstanding')).body,
      (await oGet(W.A, '/residents?limit=100')).body.items?.length,
    ]);
  const before = await snapshot(),
    ownerBefore = await ownerView();
  for (const s of [W.r1.session, W.r2.session, W.rb.session, W.rNone.session]) {
    for (const p of [...ME_ROUTES, '/me/invoices?limit=50', '/me/payments?limit=50'])
      assert.equal((await me(s, p)).status, 200);
  }
  for (const p of Object.values(W.r1.invoices))
    assert.equal((await me(W.r1.session, `/me/invoices/${p}`)).status, 200);
  for (const p of Object.values(W.r1.payments))
    assert.equal((await me(W.r1.session, `/me/receipts/${p}`)).status, 200);
  assert.equal(await snapshot(), before, 'no row in any financial or domain table changed');
  assert.equal(
    await ownerView(),
    ownerBefore,
    'owner invoice, outstanding and resident views are unchanged',
  );
  // and the financial workflow still works after resident reads: a new payment moves both views consistently
  const extra = await pay(W.A, W.r1.invoices.m0, '2000.00', {
    method: 'CASH',
    reference: 'CASH-9999-ZZZZ',
    receivedAt: new Date().toISOString(),
  });
  const after = await me(W.r1.session, `/me/invoices/${W.r1.invoices.m0}`);
  assert.equal(after.body.data.paidAmount, '2000.00');
  assert.equal(after.body.data.status, 'PARTIALLY_PAID');
  assert.equal(
    after.body.data.outstandingAmount,
    (await oGet(W.A, `/finance/invoices/${W.r1.invoices.m0}`)).body.balance,
  );
  assert.equal((await me(W.r1.session, `/me/receipts/${extra}`)).status, 200);
});
