import assert from 'node:assert/strict';
import test from 'node:test';
import { BILLABLE_STATUSES, OPEN_STATUSES } from '../src/finance/finance.service.js';
import { Decimal } from '../src/finance/finance.util.js';
import {
  MAX_PAGE_SIZE,
  RESIDENT_VISIBLE_INVOICE_STATUSES,
  maskReference,
  notFound,
  parseResidentPagination,
  toInvoiceDetailDto,
  toInvoiceDto,
  toPage,
  toPaymentDto,
  toProfileDto,
  toReceiptDto,
  toRentSummaryDto,
  toStayDto,
  type StaySummaryInput,
} from '../src/resident-self/resident-self.dto.js';

// Database-free tests of the resident self-service shaping layer. The HTTP behaviour against PostgreSQL (ownership, isolation,
// sessions, pagination, financial agreement with the owner views) is in integration/resident-self.integration.test.ts.

const D = (v: string) => new Decimal(v);
const FORBIDDEN_KEYS = [
  'organizationId',
  'residentId',
  'accountId',
  'userId',
  'passwordHash',
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
  'tokenHash',
  'codeHash',
  'createdBy',
  'reversedBy',
  'actor',
  'metadata',
];
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  return out;
}
const assertNoForbidden = (dto: unknown) => {
  const keys = keysOf(dto);
  for (const bad of FORBIDDEN_KEYS)
    assert.equal(
      keys.has(bad),
      false,
      `forbidden key ${bad} in ${JSON.stringify(dto).slice(0, 200)}`,
    );
};

const today = new Date('2026-11-20T00:00:00.000Z');
const baseInvoice = {
  id: 'i1',
  number: 'INV-2026-0001',
  periodStart: new Date('2026-10-01'),
  periodEnd: new Date('2026-10-31'),
  issuedAt: new Date('2026-10-02T04:00:00Z'),
  dueDate: new Date('2026-10-05'),
  amount: D('8000'),
  paidAmount: D('3000'),
  status: 'PARTIALLY_PAID',
};
// extra, forbidden fields as an over-selecting query (or a future schema change) might deliver them: the mappers must ignore them
const leaky = {
  organizationId: 'o',
  residentId: 'r',
  notes: 'INTERNAL',
  adjustmentTotal: D('500'),
  adjustments: [{ reason: 'staff' }],
  voids: [{ reason: 'x' }],
  storedStatus: 'ISSUED',
};

test("visible invoice statuses are exactly the owner side's billable set; drafts and cancelled invoices are never visible", () => {
  assert.deepEqual([...RESIDENT_VISIBLE_INVOICE_STATUSES].sort(), [
    'ISSUED',
    'OVERDUE',
    'PAID',
    'PARTIALLY_PAID',
  ]);
  assert.deepEqual([...RESIDENT_VISIBLE_INVOICE_STATUSES], [...BILLABLE_STATUSES]);
  assert.ok(!(RESIDENT_VISIBLE_INVOICE_STATUSES as readonly string[]).includes('DRAFT'));
  assert.ok(!(RESIDENT_VISIBLE_INVOICE_STATUSES as readonly string[]).includes('CANCELLED'));
  assert.ok(OPEN_STATUSES.every((s) => (BILLABLE_STATUSES as readonly string[]).includes(s)));
});

test('pagination: defaults, bounds and refusal of anything else (a 400 with a code, never a larger page)', () => {
  assert.deepEqual(parseResidentPagination({}), { page: 1, limit: 20 });
  assert.deepEqual(parseResidentPagination(undefined), { page: 1, limit: 20 });
  assert.deepEqual(parseResidentPagination({ page: '3', limit: '50' }), { page: 3, limit: 50 });
  for (const bad of [
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'abc' },
    { page: '1e3' },
    { limit: '0' },
    { limit: String(MAX_PAGE_SIZE + 1) },
    { limit: '1000000' },
    { page: ['1', '2'] },
    { limit: { a: 1 } },
    { page: '9999999999' },
  ]) {
    assert.throws(
      () => parseResidentPagination(bad),
      (e: { getResponse?: () => { code?: string } }) =>
        e.getResponse?.().code === 'INVALID_PAGINATION',
      JSON.stringify(bad),
    );
  }
  const page = toPage([1, 2], 41, 2, 20);
  assert.deepEqual(page.pagination, { page: 2, limit: 20, total: 41, totalPages: 3 });
});

test('payment references are masked to the last four characters', () => {
  assert.equal(maskReference('UPI-REF-9876543210'), '****3210');
  assert.equal(maskReference('ABCD'), '****');
  assert.equal(maskReference('AB'), '****');
  assert.equal(maskReference('  '), null);
  assert.equal(maskReference(null), null);
  assert.equal(maskReference(undefined), null);
  assert.ok(!String(maskReference('SECRETREFERENCE1234')).includes('SECRET'));
});

test('profile: only the approved fields, with the phone masked and no contact, address or document data', () => {
  const dto = toProfileDto({
    phoneE164: '+919876543210',
    status: 'ACTIVE',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    resident: { firstName: 'Asha', lastName: 'Rao', status: 'ACTIVE' },
    organization: { name: 'Sunrise Hostels' },
    ...leaky,
  } as never);
  assert.deepEqual(Object.keys(dto).sort(), [
    'accountStatus',
    'displayName',
    'firstName',
    'lastName',
    'memberSince',
    'organizationName',
    'phone',
    'residentStatus',
  ]);
  assert.equal(dto.phone, '+91******3210');
  assert.equal(dto.displayName, 'Asha Rao');
  assertNoForbidden(dto);
  assert.ok(!JSON.stringify(dto).includes('9876543210'));
});

const staySummary = (over: Partial<StaySummaryInput>): StaySummaryInput => ({
  currentStay: null,
  currentStayStatus: 'NO_ACTIVE_STAY',
  upcomingBookings: [],
  lastCheckOut: null,
  ...over,
});
const booking = {
  bedLabel: 'B1',
  roomLabel: '101',
  propertyName: 'Block A',
  startDate: '2026-12-01T00:00:00.000Z',
  endDate: '2027-05-31T00:00:00.000Z',
  monthlyPrice: '8000',
};

test('stay: a current stay maps to resident fields only (hostel, room, bed, dates, rent), nothing internal', () => {
  const dto = toStayDto(
    staySummary({
      currentStayStatus: 'ACTIVE',
      currentStay: {
        booking: {
          ...booking,
          extensions: [{ approvedBy: 'Staff', reason: 'x' }],
          paymentStatus: 'PAID',
          bedId: 'bed-1',
        } as never,
        activeCheckIn: {
          checkInAt: '2026-10-01T05:00:00.000Z',
          isOverstay: true,
          bedId: 'bed-1',
        } as never,
        admission: { id: 'a' } as never,
      } as never,
    }),
    'Sunrise Hostels',
  );
  assert.equal(dto.status, 'CURRENT');
  assert.deepEqual(dto.current, {
    hostelName: 'Block A',
    organizationName: 'Sunrise Hostels',
    roomNumber: '101',
    bedNumber: 'B1',
    checkInDate: '2026-10-01T05:00:00.000Z',
    expectedCheckOutDate: '2027-05-31T00:00:00.000Z',
    monthlyRent: '8000.00',
    stayStatus: 'ACTIVE',
  });
  assert.equal(dto.lastStay, null);
  const text = JSON.stringify(dto);
  for (const hidden of ['bed-1', 'Staff', 'isOverstay', 'paymentStatus', 'extensions', 'admission'])
    assert.ok(!text.includes(hidden), hidden);
  assertNoForbidden(dto);
});

test('stay: every empty or non-current state is a safe, explicit shape', () => {
  assert.deepEqual(toStayDto(staySummary({}), 'Org'), {
    status: 'NONE',
    current: null,
    upcoming: [],
    lastStay: null,
  });
  const upcoming = toStayDto(
    staySummary({
      upcomingBookings: [
        { booking, classification: 'FUTURE_NO_ADMISSION' },
        { booking, classification: 'HISTORICAL' },
      ],
    }),
    'Org',
  );
  assert.equal(upcoming.status, 'UPCOMING');
  assert.equal(upcoming.upcoming.length, 1, 'historical bookings are not shown');
  assert.equal(upcoming.upcoming[0]!.stage, 'BOOKED');
  assert.equal(upcoming.current, null);
  for (const [c, stage] of [
    ['ADMISSION_PENDING', 'ADMISSION_PENDING'],
    ['ADMITTED_AWAITING_CHECKIN', 'ADMITTED_AWAITING_CHECK_IN'],
    ['START_DATE_PASSED_NO_CHECKIN', 'START_DATE_PASSED'],
  ] as const)
    assert.equal(
      toStayDto(staySummary({ upcomingBookings: [{ booking, classification: c }] }), 'Org')
        .upcoming[0]!.stage,
      stage,
    );
  const done = toStayDto(
    staySummary({
      lastCheckOut: {
        checkOutAt: '2026-09-30T05:00:00.000Z',
        reason: 'private',
        notes: 'private',
      } as never,
    }),
    'Org',
  );
  assert.deepEqual(done, {
    status: 'COMPLETED',
    current: null,
    upcoming: [],
    lastStay: { checkedOutAt: '2026-09-30T05:00:00.000Z' },
  });
  assert.ok(!JSON.stringify(done).includes('private'));
  assert.deepEqual(
    toStayDto(staySummary({ currentStayStatus: 'INCONSISTENT_ACTIVE_CHECK_INS' }), 'Org'),
    { status: 'UNDER_REVIEW', current: null, upcoming: [], lastStay: null },
  );
  // a stray ACTIVE label without a stay record is not shown as current
  assert.equal(
    toStayDto(staySummary({ currentStayStatus: 'ACTIVE', currentStay: null }), 'Org').status,
    'NONE',
  );
});

test('invoice: amounts use the owner definition, overdue is derived from the due date, and only listed fields exist', () => {
  const dto = toInvoiceDto({ ...baseInvoice, ...leaky } as never, today);
  assert.deepEqual(Object.keys(dto).sort(), [
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
  assert.equal(dto.totalAmount, '8000.00');
  assert.equal(dto.paidAmount, '3000.00');
  assert.equal(dto.outstandingAmount, '5000.00');
  assert.equal(dto.status, 'OVERDUE', 'open and past due');
  assert.equal(dto.dueDate, '2026-10-05');
  assert.equal(
    toInvoiceDto({ ...baseInvoice, dueDate: new Date('2026-12-05') }, today).status,
    'PARTIALLY_PAID',
  );
  assert.equal(
    toInvoiceDto({ ...baseInvoice, status: 'PAID', paidAmount: D('8000') }, today).status,
    'PAID',
  );
  assert.equal(toInvoiceDto({ ...baseInvoice, issuedAt: null }, today).issuedAt, null);
  assertNoForbidden(dto);
});

const payment = {
  id: 'p1',
  amount: D('3000'),
  method: 'UPI',
  reference: 'UPI-REF-9876543210',
  receivedAt: new Date('2026-10-03T06:00:00Z'),
  reversals: [] as Array<{ id: string }>,
};

test('payment and invoice detail: masked reference, COMPLETED or REVERSED only, no reversal reason, actor, note or correction link', () => {
  const ok = toPaymentDto({
    ...payment,
    invoice: { id: 'i1', number: 'INV-2026-0001' },
    ...({ notes: 'INTERNAL', correctsPaymentId: 'x', creditTotalAtPayment: D('1') } as object),
  } as never);
  assert.deepEqual(Object.keys(ok).sort(), [
    'amount',
    'id',
    'invoice',
    'method',
    'paidAt',
    'receiptNumber',
    'reference',
    'status',
  ]);
  assert.equal(ok.status, 'COMPLETED');
  assert.equal(ok.reference, '****3210');
  assert.equal(ok.receiptNumber, 'RCPT-p1');
  const reversed = toPaymentDto({
    ...payment,
    reversals: [{ id: 'rv1', reason: 'cheque bounced', actor: 'Staff' } as never],
    invoice: { id: 'i1', number: 'N' },
  });
  assert.equal(reversed.status, 'REVERSED');
  const detail = toInvoiceDetailDto(
    {
      ...baseInvoice,
      ...leaky,
      payments: [payment, { ...payment, id: 'p2', reversals: [{ id: 'rv' }] }],
    } as never,
    today,
  );
  assert.deepEqual(
    detail.payments.map((p) => p.status),
    ['COMPLETED', 'REVERSED'],
  );
  const all = JSON.stringify([ok, reversed, detail]);
  for (const hidden of ['INTERNAL', 'cheque bounced', 'Staff', 'UPI-REF', 'reversedBy', 'rv1'])
    assert.ok(!all.includes(hidden), hidden);
  assertNoForbidden([ok, reversed, detail]);
});

test('rent summary: the status label is presentation of the authoritative figures', () => {
  const base = {
    invoiced: D('16000'),
    paid: D('8000'),
    invoiceCount: 2,
    outstanding: '8000.00',
    overdue: '0.00',
    nextDueDate: new Date('2026-12-05'),
  };
  assert.equal(toRentSummaryDto(base).status, 'DUE');
  assert.equal(toRentSummaryDto({ ...base, overdue: '8000.00' }).status, 'OVERDUE');
  assert.equal(
    toRentSummaryDto({ ...base, outstanding: '0.00', paid: D('16000'), nextDueDate: null }).status,
    'PAID_UP',
  );
  assert.equal(
    toRentSummaryDto({
      ...base,
      invoiceCount: 0,
      invoiced: D('0'),
      paid: D('0'),
      outstanding: '0.00',
      nextDueDate: null,
    }).status,
    'NO_INVOICES',
  );
  const dto = toRentSummaryDto(base);
  assert.deepEqual(Object.keys(dto).sort(), [
    'invoiceCount',
    'nextDueDate',
    'outstanding',
    'overdue',
    'status',
    'totalInvoiced',
    'totalPaid',
  ]);
  assert.deepEqual(
    [dto.totalInvoiced, dto.totalPaid, dto.outstanding, dto.overdue, dto.nextDueDate],
    ['16000.00', '8000.00', '8000.00', '0.00', '2026-12-05'],
  );
});

test('receipt: built from the owner receipt without notes, credit snapshots, source flags or ids, with the reference masked', () => {
  const dto = toReceiptDto(
    {
      organizationName: 'Sunrise Hostels',
      invoice: {
        number: 'INV-2026-0001',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        amount: '8000.00',
        paidAmount: '3000.00',
        balance: '5000.00',
        status: 'PARTIALLY_PAID',
        ...({ id: 'i1', residentName: 'X', adjustmentTotal: '500.00' } as object),
      } as never,
      receipts: [
        {
          reversed: false,
          receiptNumber: 'RCPT-p1',
          paymentId: 'p1',
          amount: '3000.00',
          method: 'UPI',
          reference: 'UPI-REF-9876543210',
          receivedAt: '2026-10-03T06:00:00.000Z',
          balanceAfterPayment: '5000.00',
          ...({
            notes: 'INTERNAL',
            creditTotalAtPayment: '0.00',
            balanceSource: 'recorded',
            reversedAt: null,
          } as object),
        } as never,
      ],
    },
    'Asha Rao',
  );
  assert.deepEqual(Object.keys(dto).sort(), [
    'balanceAfterPayment',
    'invoice',
    'issuedBy',
    'issuedTo',
    'payment',
    'receiptNumber',
  ]);
  assert.equal(dto.payment.reference, '****3210');
  assert.equal(dto.issuedTo, 'Asha Rao');
  assert.equal(dto.invoice.outstandingAmount, '5000.00');
  assertNoForbidden(dto);
  assert.ok(
    !JSON.stringify(dto).includes('INTERNAL') && !JSON.stringify(dto).includes('adjustment'),
  );
  assert.throws(() =>
    toReceiptDto({ organizationName: 'x', invoice: dto.invoice as never, receipts: [] }, 'x'),
  );
});

test("errors: a record that is not the resident's is reported exactly as one that does not exist", () => {
  const e = notFound();
  assert.equal(e.getStatus(), 404);
  assert.deepEqual(e.getResponse(), { code: 'NOT_FOUND' });
});
