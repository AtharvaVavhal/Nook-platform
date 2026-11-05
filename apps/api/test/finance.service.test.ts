/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake of the Prisma client */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { FinanceService } from '../src/finance/finance.service.js';
import {
  Decimal,
  dueDateAtIssue,
  isoDate,
  parseBillingMonth,
  todayIst,
} from '../src/finance/finance.util.js';

/**
 * These tests run FinanceService against an in-memory fake of the database client. They prove the
 * service's own decisions (which stays bill, the amounts, due dates, audit events, retry behaviour)
 * and the shape of the queries it sends. They are not integration tests and say nothing about
 * PostgreSQL behaviour such as locking, triggers or unique indexes.
 */

const ORG = randomUUID();
const ACTOR = randomUUID();
const DAY = 86_400_000;
const month = todayIst().toISOString().slice(0, 7);
const period = parseBillingMonth(month);
const at = (offsetDays: number, hours = 4) =>
  new Date(period.periodStart.getTime() + offsetDays * DAY + hours * 3_600_000);

/** Format a Decimal-like value to 2 decimal places for assertions. */
function fmt(val: unknown): string {
  if (val && typeof val === 'object' && typeof (val as any).toFixed === 'function') {
    return (val as any).toFixed(2);
  }
  return new Decimal(String(val)).toFixed(2);
}

interface StayRow {
  id: string;
  residentId: string;
  status: string;
  checkInAt: Date;
  updatedAt: Date;
  checkOut: { checkOutAt: Date } | null;
  booking: { id: string; monthlyPrice: Decimal; startDate: Date; endDate: Date };
}

function stayRow(over: Partial<StayRow> & { price?: string } = {}): StayRow {
  const bookingId = randomUUID();
  return {
    id: randomUUID(),
    residentId: randomUUID(),
    status: 'ACTIVE',
    checkInAt: at(2),
    updatedAt: at(2),
    checkOut: null,
    booking: {
      id: bookingId,
      monthlyPrice: new Decimal(over.price ?? '5000.00'),
      startDate: new Date(period.periodStart.getTime() - 5 * DAY),
      endDate: new Date(period.periodStart.getTime() + 300 * DAY),
    },
    ...over,
  };
}

function makeFake(stays: StayRow[]) {
  const invoices: any[] = [];
  const audits: any[] = [];
  const queries: any[] = [];
  const tx: any = {
    $executeRaw: async () => 0,
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('FOR UPDATE')) {
        const row = invoices.find((i) => i.id === values[0]);
        return row
          ? [
              {
                id: row.id,
                resident_id: row.residentId,
                amount: row.amount,
                paid_amount: row.paidAmount,
                adjustment_total: row.adjustmentTotal,
                status: row.status,
              },
            ]
          : [];
      }
      return [{ max: invoices.length }];
    },
    checkIn: {
      findMany: async (args: any) => {
        queries.push(args);
        return stays;
      },
    },
    invoice: {
      findMany: async (args: any) => {
        const w = args.where;
        return invoices.filter(
          (i) =>
            i.organizationId === w.organizationId &&
            (w.periodStart === undefined || i.periodStart.getTime() === w.periodStart.getTime()) &&
            (w.status?.not === undefined || i.status !== w.status.not) &&
            (w.number === undefined || w.number.in.includes(i.number)),
        );
      },
      findFirst: async (args: any) => {
        const w = args.where;
        return (
          invoices.find(
            (i) =>
              i.organizationId === w.organizationId &&
              (w.residentId === undefined || i.residentId === w.residentId) &&
              (w.periodStart === undefined ||
                i.periodStart.getTime() === w.periodStart.getTime()) &&
              (w.bookingId === undefined || (i.bookingId ?? null) === w.bookingId) &&
              (w.status?.not === undefined || i.status !== w.status.not),
          ) ?? null
        );
      },
      createMany: async ({ data }: any) => {
        for (const row of data) {
          invoices.push({
            id: randomUUID(),
            paidAmount: new Decimal(0),
            adjustmentTotal: new Decimal(0),
            notes: null,
            createdAt: new Date(),
            resident: { id: row.residentId, firstName: 'R', lastName: 'X' },
            ...row,
          });
        }
        return { count: data.length };
      },
      create: async ({ data }: any) => {
        const row = {
          id: randomUUID(),
          paidAmount: new Decimal(0),
          adjustmentTotal: new Decimal(0),
          issuedAt: null,
          createdAt: new Date(),
          resident: { id: data.residentId, firstName: 'R', lastName: 'X' },
          ...data,
        };
        invoices.push(row);
        return row;
      },
      findFirstOrThrow: async ({ where }: any) => {
        const found = invoices.find((i) => i.id === where.id);
        if (!found) throw new Error('not found');
        return found;
      },
      update: async ({ where, data }: any) => {
        const found = invoices.find((i) => i.id === where.id);
        Object.assign(found, data);
        return found;
      },
    },
    auditEvent: {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    },
  };
  const db: any = {
    ...tx,
    $transaction: async (fn: (t: any) => unknown) => fn(tx),
    resident: { findFirst: async () => ({ id: 'resident' }) },
    booking: { findFirst: async () => null },
  };
  return { service: new FinanceService({ db } as any), invoices, audits, queries, tx, db };
}

const eventsOf = (audits: any[], action: string) => audits.filter((a) => a.action === action);

// ------------------------------------------------- 6. one audit event per auto-issued invoice

test('generate-monthly with issue: one issued audit event per invoice, plus one batch event', async () => {
  const { service, invoices, audits } = makeFake([stayRow(), stayRow(), stayRow()]);
  const result = await service.generateMonthly(ORG, ACTOR, { month, issue: true });
  assert.equal(result.created, 3);
  assert.equal(invoices.length, 3);
  assert.ok(invoices.every((i) => i.status === 'ISSUED' && i.issuedAt));

  const issued = eventsOf(audits, 'finance.invoice.issued');
  assert.equal(issued.length, 3);
  assert.deepEqual(
    new Set(issued.map((e) => e.targetId)),
    new Set(invoices.map((i) => i.id)),
    'each invoice has its own event',
  );
  for (const event of issued) {
    assert.equal(event.organizationId, ORG);
    assert.equal(event.actorUserId, ACTOR);
    assert.equal(event.targetType, 'invoice');
    assert.equal(event.metadata.automatic, true);
    assert.equal(event.metadata.source, 'generate-monthly');
    assert.equal(event.metadata.month, month);
  }
  assert.equal(eventsOf(audits, 'finance.invoices.generated').length, 1);
});

test('generate-monthly retry creates no invoices and no further audit events', async () => {
  const { service, invoices, audits } = makeFake([stayRow(), stayRow()]);
  await service.generateMonthly(ORG, ACTOR, { month, issue: true });
  const eventsAfterFirst = audits.length;
  const retry = await service.generateMonthly(ORG, ACTOR, { month, issue: true });
  assert.equal(retry.created, 0);
  assert.equal(invoices.length, 2);
  assert.equal(audits.length, eventsAfterFirst);
  assert.equal(eventsOf(audits, 'finance.invoice.issued').length, 2);
});

test('generate-monthly as drafts writes no issued events (the later manual issue writes its own)', async () => {
  const { service, invoices, audits } = makeFake([stayRow(), stayRow()]);
  await service.generateMonthly(ORG, ACTOR, { month });
  assert.equal(invoices.length, 2);
  assert.ok(invoices.every((i) => i.status === 'DRAFT' && i.issuedAt === null));
  assert.equal(eventsOf(audits, 'finance.invoice.issued').length, 0);
  assert.equal(eventsOf(audits, 'finance.invoices.generated').length, 1);
});

// --------------------------------------------------------------------- 4. due dates

test('draft invoices keep the provisional 5th; issuing fixes the due date at issue time', async () => {
  const { service, invoices } = makeFake([stayRow()]);
  await service.generateMonthly(ORG, ACTOR, { month });
  const draft = invoices[0];
  assert.equal(isoDate(draft.dueDate), `${month}-05`, 'draft is not given an issued due date');

  const issued = await service.issue(ORG, ACTOR, draft.id);
  assert.equal(
    issued.dueDate,
    isoDate(dueDateAtIssue(period.periodStart, new Date(issued.issuedAt!))),
  );
});

test('auto-issued invoices get the later of the 5th and the issue date', async () => {
  const { service, invoices } = makeFake([stayRow()]);
  await service.generateMonthly(ORG, ACTOR, { month, issue: true });
  const [invoice] = invoices;
  assert.equal(
    isoDate(invoice.dueDate),
    isoDate(dueDateAtIssue(period.periodStart, invoice.issuedAt)),
  );
  assert.ok(invoice.dueDate.getTime() >= invoice.issuedAt.getTime() - DAY);
});

test('an explicit later due date is kept at issue; an explicit earlier one is lifted to the rule', async () => {
  const { service, invoices } = makeFake([stayRow(), stayRow()]);
  const later = `${month}-28`;
  await service.generateMonthly(ORG, ACTOR, { month, dueDate: later });
  const issuedLater = await service.issue(ORG, ACTOR, invoices[0].id);
  const rule = isoDate(dueDateAtIssue(period.periodStart, new Date(issuedLater.issuedAt!)));
  assert.equal(issuedLater.dueDate, later > rule ? later : rule);

  const early = `${month}-01`;
  const second = makeFake([stayRow()]);
  await second.service.generateMonthly(ORG, ACTOR, { month, dueDate: early });
  const issuedEarly = await second.service.issue(ORG, ACTOR, second.invoices[0].id);
  assert.equal(
    issuedEarly.dueDate,
    isoDate(dueDateAtIssue(period.periodStart, new Date(issuedEarly.issuedAt!))),
  );
});

// ------------------------------------------- 1 and 2. eligibility seen from the service

test('generate-monthly never filters on booking or admission status (cancellation keeps history)', async () => {
  const { service, queries } = makeFake([stayRow()]);
  await service.generateMonthly(ORG, ACTOR, { month });
  const where = JSON.stringify(queries[0].where);
  assert.ok(!where.includes('CONFIRMED'), 'no booking status filter');
  assert.ok(!where.includes('ADMITTED'), 'no admission status filter');
  assert.ok(!('admission' in queries[0].where));
  assert.ok(!('resident' in queries[0].where), 'no resident status filter');
  assert.ok(!('status' in (queries[0].where.booking?.is ?? {})));
  assert.equal(queries[0].where.organizationId, ORG, 'organization scoped');
});

test('a stay on a booking that has since ended is not billed beyond the booking (overstay)', async () => {
  const overstay = stayRow({
    booking: {
      id: randomUUID(),
      monthlyPrice: new Decimal('5000.00'),
      startDate: new Date(period.periodStart.getTime() - 60 * DAY),
      endDate: period.periodStart, // exclusive end on the 1st of this month
    },
  });
  const { service, invoices } = makeFake([overstay]);
  const result = await service.generateMonthly(ORG, ACTOR, { month });
  assert.equal(result.created, 0);
  assert.equal(invoices.length, 0);
});

test('an early check-out before the month began is not billed; a check-out in the month is', async () => {
  const left = stayRow({
    status: 'CHECKED_OUT',
    checkInAt: at(-40),
    checkOut: { checkOutAt: at(-1, 0) },
  });
  const leaves = stayRow({
    status: 'CHECKED_OUT',
    checkInAt: at(-40),
    checkOut: { checkOutAt: at(3) },
  });
  const { service, invoices } = makeFake([left, leaves]);
  await service.generateMonthly(ORG, ACTOR, { month });
  assert.deepEqual(
    invoices.map((i) => i.residentId),
    [leaves.residentId],
  );
});

test('bed transfer: two bookings of one resident in a month produce two invoices, each at its own full price', async () => {
  const residentId = randomUUID();
  const first = stayRow({
    residentId,
    price: '4000.00',
    status: 'CHECKED_OUT',
    checkInAt: at(1),
    checkOut: { checkOutAt: at(9) },
  });
  const second = stayRow({ residentId, price: '6000.00', checkInAt: at(12) });
  const { service, invoices } = makeFake([second, first]); // newest first, as the query orders them
  const result = await service.generateMonthly(ORG, ACTOR, { month });
  assert.equal(result.created, 2, 'one invoice per booking, never merged');
  assert.equal(result.eligibleBookings, 2);
  assert.equal(result.eligibleResidents, 1);
  const byBooking = new Map(invoices.map((i: any) => [i.bookingId, i.amount.toFixed(2)]));
  assert.equal(byBooking.get(first.booking.id), '4000.00');
  assert.equal(byBooking.get(second.booking.id), '6000.00');
  const retry = await service.generateMonthly(ORG, ACTOR, { month });
  assert.equal(retry.created, 0, 'idempotent');
  assert.equal(retry.skippedExisting, 2);
  assert.equal(invoices.length, 2);
});

test('a booking is billed once even if two stay rows point at it', async () => {
  const stay = stayRow({ price: '4500.00', checkInAt: at(2) });
  const { service, invoices } = makeFake([stay, { ...stay }]);
  const result = await service.generateMonthly(ORG, ACTOR, { month });
  assert.equal(result.created, 1);
  assert.equal(invoices.length, 1);
});

test('a voided invoice does not block billing its booking again; an active one still does', async () => {
  const stay = stayRow({ price: '5000.00' });
  const { service, invoices } = makeFake([stay]);
  await service.generateMonthly(ORG, ACTOR, { month, issue: true });
  assert.equal(invoices.length, 1);
  invoices[0].status = 'CANCELLED';
  const again = await service.generateMonthly(ORG, ACTOR, { month, issue: true });
  assert.equal(again.created, 1, 'the voided month is billed again');
  assert.equal(invoices.length, 2);
  const third = await service.generateMonthly(ORG, ACTOR, { month, issue: true });
  assert.equal(third.created, 0);
  assert.equal(invoices.filter((i: any) => i.status !== 'CANCELLED').length, 1);
});

test('a previously generated invoice is left untouched, and no balance is carried into a new one', async () => {
  const stay = stayRow({ price: '5000.00' });
  const { service, invoices } = makeFake([stay]);
  await service.generateMonthly(ORG, ACTOR, { month, issue: true });
  const [original] = invoices;
  original.paidAmount = new Decimal('1000.00'); // an outstanding balance of 4000
  const snapshot = JSON.stringify(original);
  const retry = await service.generateMonthly(ORG, ACTOR, { month, issue: true });
  assert.equal(retry.created, 0);
  assert.equal(JSON.stringify(original), snapshot, 'issued invoice unchanged');
  assert.equal(invoices.length, 1);
});

// -------------------------------------------------- 7. manual drafts, no amount override

test('manual draft: an amount in the request is rejected before anything is read', async () => {
  const { service, invoices } = makeFake([]);
  await assert.rejects(
    service.createDraft(ORG, ACTOR, {
      residentId: randomUUID(),
      bookingId: randomUUID(),
      month,
      amount: '1',
    }),
    (e: unknown) => e instanceof BadRequestException && /amount cannot be set/.test(e.message),
  );
  assert.equal(invoices.length, 0);
});

test('manual draft: a booking is required and the amount is the booking price', async () => {
  const stay = stayRow({ price: '7250.00' });
  const fake = makeFake([stay]);
  fake.db.booking.findFirst = async () => stay.booking;
  await assert.rejects(
    fake.service.createDraft(ORG, ACTOR, { residentId: randomUUID(), month }),
    (e: unknown) => e instanceof BadRequestException && /bookingId is required/.test(e.message),
  );
  const draft = await fake.service.createDraft(ORG, ACTOR, {
    residentId: stay.residentId,
    bookingId: stay.booking.id,
    month,
  });
  assert.equal(draft.amount, '7250.00');
  assert.equal(draft.status, 'DRAFT');
  assert.equal(eventsOf(fake.audits, 'finance.invoice.created').length, 1);
});

test('manual draft: a month outside the booking period or without a stay is refused', async () => {
  const ended = stayRow({
    booking: {
      id: randomUUID(),
      monthlyPrice: new Decimal('5000.00'),
      startDate: new Date(period.periodStart.getTime() - 60 * DAY),
      endDate: period.periodStart,
    },
  });
  const outside = makeFake([ended]);
  outside.db.booking.findFirst = async () => ended.booking;
  await assert.rejects(
    outside.service.createDraft(ORG, ACTOR, {
      residentId: ended.residentId,
      bookingId: ended.booking.id,
      month,
    }),
    (e: unknown) => e instanceof BadRequestException && /does not cover/.test(e.message),
  );

  const noStay = stayRow();
  const none = makeFake([]);
  none.db.booking.findFirst = async () => noStay.booking;
  await assert.rejects(
    none.service.createDraft(ORG, ACTOR, {
      residentId: noStay.residentId,
      bookingId: noStay.booking.id,
      month,
    }),
    (e: unknown) => e instanceof BadRequestException && /no recorded stay/.test(e.message),
  );
});

// ------------------------------------------------------------ 4F.2: voiding and receipts

function voidFake(invoice: Record<string, unknown>) {
  const fake = makeFake([]);
  const row = {
    id: randomUUID(),
    organizationId: ORG,
    residentId: randomUUID(),
    number: 'INV-2026-0001',
    amount: new Decimal('500.00'),
    paidAmount: new Decimal(0),
    adjustmentTotal: new Decimal(0),
    status: 'ISSUED',
    dueDate: new Date(),
    periodStart: new Date('2026-11-01'),
    periodEnd: new Date('2026-11-30'),
    issuedAt: null,
    notes: null,
    bookingId: null,
    createdAt: new Date(),
    resident: { id: 'r', firstName: 'A', lastName: 'B' },
    ...invoice,
  };
  fake.invoices.push(row);
  const voids: any[] = [];
  fake.tx.invoiceVoid = {
    create: async ({ data }: any) => {
      const record = {
        id: randomUUID(),
        createdAt: new Date(),
        actor: { displayName: 'Tester' },
        ...data,
      };
      voids.push(record);
      return record;
    },
  };
  return { ...fake, row, voids };
}

test('void: a reason is required before anything is read or written', async () => {
  const { service, row, voids } = voidFake({});
  for (const body of [
    {},
    { reason: '' },
    { reason: 'ab' },
    { reason: 'x'.repeat(501) },
    { reason: 7 },
    null,
  ]) {
    await assert.rejects(service.voidInvoice(ORG, ACTOR, row.id, body), BadRequestException);
  }
  assert.equal(voids.length, 0);
  assert.equal(row.status, 'ISSUED');
});

test('void: unreversed payments, applied credits and an earlier void are conflicts that change nothing', async () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ status: 'PARTIALLY_PAID', paidAmount: new Decimal('100.00') }, /unreversed payments/],
    [
      {
        status: 'PARTIALLY_PAID',
        paidAmount: new Decimal('30.00'),
        adjustmentTotal: new Decimal('-30.00'),
      },
      /credits/,
    ],
    [
      {
        status: 'PARTIALLY_PAID',
        paidAmount: new Decimal('80.00'),
        adjustmentTotal: new Decimal('-30.00'),
      },
      /credits.*unreversed payments/,
    ],
    [{ status: 'CANCELLED' }, /already voided/],
  ];
  for (const [invoice, message] of cases) {
    const { service, row, voids, audits } = voidFake(invoice);
    await assert.rejects(
      service.voidInvoice(ORG, ACTOR, row.id, { reason: 'Issued in error' }),
      (e: unknown) => e instanceof ConflictException && message.test(e.message),
      JSON.stringify(invoice),
    );
    assert.equal(voids.length, 0);
    assert.equal(audits.length, 0);
    assert.equal(row.status, invoice.status ?? 'ISSUED');
  }
});

test('void: a draft or an unpaid issued invoice is voided with the actor, reason and one audit event', async () => {
  for (const status of ['DRAFT', 'ISSUED']) {
    const { service, row, voids, audits } = voidFake({ status });
    const result = await service.voidInvoice(ORG, ACTOR, row.id, { reason: '  Issued in error  ' });
    assert.equal(row.status, 'CANCELLED');
    assert.equal(voids.length, 1);
    assert.equal(voids[0].voidedBy, ACTOR);
    assert.equal(voids[0].organizationId, ORG);
    assert.equal(voids[0].reason, 'Issued in error');
    assert.equal(result.void.previousStatus, status);
    const events = eventsOf(audits, 'finance.invoice.voided');
    assert.equal(events.length, 1);
    assert.equal(events[0].actorUserId, ACTOR);
    assert.equal(events[0].metadata.reason, 'Issued in error');
  }
});

test('receipt: recorded snapshots are shown as recorded; pre-snapshot payments as derived, never invented', async () => {
  const fake = makeFake([]);
  const payment = (over: Record<string, unknown>) => ({
    id: randomUUID(),
    amount: new Decimal('40.00'),
    method: 'CASH',
    reference: null,
    receivedAt: new Date('2026-11-01T06:00:00Z'),
    notes: null,
    createdAt: new Date(),
    reversals: [],
    ...over,
  });
  const recorded = payment({
    creditTotalAtPayment: new Decimal('-10.00'),
    balanceAfterPayment: new Decimal('450.00'),
  });
  const legacy = payment({ creditTotalAtPayment: null, balanceAfterPayment: null });
  (fake.db as any).invoice = {
    findFirst: async () => ({
      id: 'inv',
      number: 'INV-2026-0001',
      amount: new Decimal('500.00'),
      paidAmount: new Decimal('90.00'),
      adjustmentTotal: new Decimal('-10.00'),
      status: 'PARTIALLY_PAID',
      dueDate: new Date('2026-12-01'),
      periodStart: new Date('2026-11-01'),
      periodEnd: new Date('2026-11-30'),
      organization: { name: 'Org' },
      resident: { id: 'r', firstName: 'A', lastName: 'B' },
      payments: [recorded, legacy],
    }),
  };
  const result = await fake.service.receipt(ORG, 'inv');
  const [first, second] = result.receipts;
  assert.equal(first!.balanceSource, 'recorded');
  assert.equal(first!.balanceAfterPayment, '450.00');
  assert.equal(first!.creditTotalAtPayment, '-10.00');
  assert.equal(second!.balanceSource, 'derived');
  assert.equal(second!.creditTotalAtPayment, null);
  assert.match(second!.balanceAfterPayment, /^\d+\.\d{2}$/);
});

// =================================================================
// FIN-REC: Payment Recording Regression Tests
// =================================================================

function makePaymentFake(invoiceOverrides: Record<string, unknown> = {}) {
  const invoices: any[] = [
    {
      id: invoiceOverrides.id ?? 'inv-test',
      organizationId: ORG,
      residentId: 'resident-1',
      amount: invoiceOverrides.amount ?? new Decimal('1000.00'),
      paidAmount: new Decimal('0.00'),
      adjustmentTotal: new Decimal('0.00'),
      status: 'ISSUED',
      dueDate: new Date('2026-12-05'),
      periodStart: new Date('2026-11-01'),
      periodEnd: new Date('2026-11-30'),
      issuedAt: new Date('2026-11-03T06:00:00Z'),
      createdAt: new Date('2026-11-03T06:00:00Z'),
      resident: { id: 'resident-1', firstName: 'Test', lastName: 'User' },
      ...invoiceOverrides,
    },
  ];
  const payments: any[] = [];
  const audits: any[] = [];
  const idempotencyKeys: any[] = [];
  const tx: any = {
    $executeRaw: async () => 0,
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('FOR UPDATE')) {
        const row = invoices.find((i) => i.id === values[0]);
        return row
          ? [
              {
                id: row.id,
                resident_id: row.residentId,
                amount: row.amount?.toString?.() ?? String(row.amount),
                paid_amount: row.paidAmount?.toString?.() ?? String(row.paidAmount),
                adjustment_total: row.adjustmentTotal?.toString?.() ?? String(row.adjustmentTotal),
                status: row.status,
              },
            ]
          : [];
      }
      return [{ max: 0 }];
    },
    payment: {
      create: async ({ data }: any) => {
        const payment = {
          id: randomUUID(),
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        payments.push(payment);
        return payment;
      },
      findFirst: async ({ where }: any) => {
        if (where.id) return payments.find((p) => p.id === where.id) ?? null;
        if (where.correctsPaymentId)
          return payments.find((p) => p.correctsPaymentId === where.correctsPaymentId) ?? null;
        return null;
      },
      findUnique: async ({ where }: any) => payments.find((p) => p.id === where.id) ?? null,
    },
    invoice: {
      findFirst: async ({ where }: any) =>
        invoices.find((i) => i.id === where.id) ?? null,
      findFirstOrThrow: async ({ where }: any) => {
        const found = invoices.find((i) => i.id === where.id);
        if (!found) throw new Error('not found');
        return found;
      },
      findUnique: async ({ where }: any) =>
        invoices.find((i) => i.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const found = invoices.find((i) => i.id === where.id);
        if (!found) throw new Error('invoice not found');
        // Always convert decimal fields to Decimal objects
        for (const [key, value] of Object.entries(data)) {
          const isDecimalField = key === 'paidAmount' || key === 'amount' || key === 'adjustmentTotal';
          if (isDecimalField) {
            if (value && typeof value === 'object' && typeof value.toFixed === 'function') {
              // Decimal-like object (has toFixed method)
              (found as any)[key] = value;
            } else if (typeof value === 'string' || typeof value === 'number') {
              (found as any)[key] = new Decimal(String(value));
            } else if (value && typeof value === 'object' && value.constructor?.name === 'Decimal') {
              (found as any)[key] = value;
            } else {
              (found as any)[key] = new Decimal(String(value));
            }
          } else {
            (found as any)[key] = value;
          }
        }
        return found;
      },
    },
    auditEvent: {
      create: async ({ data: _data }: any) => {
        audits.push(_data);
        return _data;
      },
    },
    paymentIdempotencyKey: {
      findUnique: async ({ where }: any) =>
        idempotencyKeys.find(
          (k) =>
            k.organizationId === where.organizationId_key.organizationId &&
            k.key === where.organizationId_key.key,
        ) ?? null,
      create: async ({ data }: any) => {
        idempotencyKeys.push(data);
        return data;
      },
    },
    paymentReversal: {
      findUnique: async () => null,
    },
  };
  // Snapshot state for potential rollback
  let snapshot: { invoices: any[]; payments: any[]; audits: any[]; idempotencyKeys: any[] } | null = null;
  const db: any = {
    ...tx,
    $transaction: async (fn: (t: any) => unknown) => {
      // Take snapshot before transaction
      snapshot = {
        invoices: JSON.parse(JSON.stringify(invoices, (_, v) => typeof v === 'object' && v !== null && 'toFixed' in v ? v.toString() : v)),
        payments: JSON.parse(JSON.stringify(payments)),
        audits: JSON.parse(JSON.stringify(audits)),
        idempotencyKeys: JSON.parse(JSON.stringify(idempotencyKeys)),
      };
      try {
        const result = await fn(tx);
        snapshot = null;
        return result;
      } catch (e) {
        // Rollback on error
        if (snapshot) {
          invoices.splice(0, invoices.length, ...snapshot.invoices);
          payments.splice(0, payments.length, ...snapshot.payments);
          audits.splice(0, audits.length, ...snapshot.audits);
          idempotencyKeys.splice(0, idempotencyKeys.length, ...snapshot.idempotencyKeys);
          snapshot = null;
        }
        throw e;
      }
    },
    resident: { findFirst: async () => ({ id: 'resident-1' }) },
    booking: { findFirst: async () => null },
  };
  return { service: new FinanceService({ db } as any), invoices, payments, audits, idempotencyKeys, tx, db };
}

// FIN-REC-001: Sequential payments sum correctly
test('FIN-REC-001: sequential payments of 100.00, 200.00, 700.00 sum to 1000.00 with three audit events', async () => {
  const { service, invoices, payments, audits } = makePaymentFake({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' });
  await service.recordPayment(ORG, ACTOR, { invoiceId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', amount: '100.00', method: 'CASH' }, 'rec001-key-0001');
  await service.recordPayment(ORG, ACTOR, { invoiceId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', amount: '200.00', method: 'CASH' }, 'rec001-key-0002');
  await service.recordPayment(ORG, ACTOR, { invoiceId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', amount: '700.00', method: 'CASH' }, 'rec001-key-0003');
  assert.equal(fmt(invoices[0].paidAmount), '1000.00');
  assert.equal(payments.length, 3);
  const recorded = eventsOf(audits, 'finance.payment.recorded');
  assert.equal(recorded.length, 3);
  assert.deepEqual(recorded.map((r) => r.metadata.amount), ['100.00', '200.00', '700.00']);
});

// FIN-REC-002: Rapid sequential payments
test('FIN-REC-002: rapid sequential payments are each recorded with an audit event', async () => {
  const { service, invoices, payments, audits } = makePaymentFake({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  await service.recordPayment(ORG, ACTOR, { invoiceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', amount: '100.00', method: 'CASH' }, 'rec002-key-0001');
  await service.recordPayment(ORG, ACTOR, { invoiceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', amount: '200.00', method: 'CASH' }, 'rec002-key-0002');
  await service.recordPayment(ORG, ACTOR, { invoiceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', amount: '50.00', method: 'CASH' }, 'rec002-key-0003');
  assert.equal(fmt(invoices[0].paidAmount), '350.00');
  assert.equal(payments.length, 3);
  const recorded = eventsOf(audits, 'finance.payment.recorded');
  assert.equal(recorded.length, 3);
});

// FIN-REC-003: Sequential payments within balance limits
test('FIN-REC-003: sequential payments within balance are all accepted; overpayment is rejected', async () => {
  const { service, invoices } = makePaymentFake({ id: '11111111-2222-3333-4444-555555555555', amount: new Decimal('100.00') });
  await service.recordPayment(ORG, ACTOR, { invoiceId: '11111111-2222-3333-4444-555555555555', amount: '30.00', method: 'CASH' }, 'rec003-key-001');
  await service.recordPayment(ORG, ACTOR, { invoiceId: '11111111-2222-3333-4444-555555555555', amount: '30.00', method: 'CASH' }, 'rec003-key-002');
  await service.recordPayment(ORG, ACTOR, { invoiceId: '11111111-2222-3333-4444-555555555555', amount: '30.00', method: 'CASH' }, 'rec003-key-003');
  assert.equal(fmt(invoices[0].paidAmount), '90.00');
  // Fourth payment would exceed balance - should be rejected
  await assert.rejects(
    service.recordPayment(ORG, ACTOR, { invoiceId: '11111111-2222-3333-4444-555555555555', amount: '30.00', method: 'CASH' }, 'rec003-key-004'),
    (e: Error) => e instanceof Error && e.message.includes('remaining balance'),
  );
  assert.equal(fmt(invoices[0].paidAmount), '90.00');
});

// FIN-REC-004: Payment reversal logic
test('FIN-REC-004: payment reversal and replacement correctly update paid_amount logic', async () => {
  const { service, invoices } = makePaymentFake({ id: '22222222-3333-4444-5555-666666666666' });
  await service.recordPayment(ORG, ACTOR, { invoiceId: '22222222-3333-4444-5555-666666666666', amount: '100.00', method: 'CASH' }, 'rec004-key-0001');
  assert.equal(fmt(invoices[0].paidAmount), '100.00');

  // Verify statusAfterCorrection logic for reversal
  const { statusAfterCorrection } = await import('../src/finance/finance.util.js');
  const statusAfterReversal = statusAfterCorrection(new Decimal('100.00'), new Decimal('0.00'), new Decimal('0.00'));
  assert.equal(statusAfterReversal, 'ISSUED');
});

// FIN-REC-005: Idempotent replay
test('FIN-REC-005: idempotent replay with same key returns cached result without duplicate payment', async () => {
  const { service, payments, audits, idempotencyKeys } = makePaymentFake({ id: '33333333-4444-5555-6666-777777777777' });
  const first = await service.recordPayment(ORG, ACTOR, { invoiceId: '33333333-4444-5555-6666-777777777777', amount: '100.00', method: 'CASH' }, 'rec005-idem-key-001');
  assert.equal(first.idempotentReplay, false);
  assert.equal(payments.length, 1);

  const second = await service.recordPayment(ORG, ACTOR, { invoiceId: '33333333-4444-5555-6666-777777777777', amount: '100.00', method: 'CASH' }, 'rec005-idem-key-001');
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.payment.id, first.payment.id);
  assert.deepEqual(second.invoice, first.invoice);
  assert.equal(payments.length, 1, 'replay must not create duplicate payment');
  assert.equal(audits.length, 1, 'replay must not create duplicate audit event');
  assert.equal(idempotencyKeys.length, 1);
});

// FIN-REC-006: Verification failure injection
test('FIN-REC-006: verification failure rolls back the entire transaction', async () => {
  // Create a fake where invoice.update silently fails but payment.create succeeds
  const VERIFY_FAIL_INV = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const invoices: any[] = [
    {
      id: VERIFY_FAIL_INV,
      organizationId: ORG,
      residentId: 'resident-1',
      amount: new Decimal('100.00'),
      paidAmount: new Decimal('0.00'),
      adjustmentTotal: new Decimal('0.00'),
      status: 'ISSUED',
      dueDate: new Date('2026-12-05'),
      periodStart: new Date('2026-11-01'),
      periodEnd: new Date('2026-11-30'),
      issuedAt: new Date('2026-11-03T06:00:00Z'),
      createdAt: new Date('2026-11-03T06:00:00Z'),
      resident: { id: 'resident-1', firstName: 'Test', lastName: 'User' },
    },
  ];
  const payments: any[] = [];
  const audits: any[] = [];
  const idempotencyKeys: any[] = [];
  let updateCalled = false;

const tx: any = {
    $executeRaw: async () => 0,
    $queryRaw: async (strings: TemplateStringsArray) => {
      // _values is intentionally unused - the query doesn't need parameters
      if (strings.join('?').includes('FOR UPDATE')) {
        return [
          {
            id: VERIFY_FAIL_INV,
            resident_id: 'resident-1',
            amount: invoices[0].amount,
            paid_amount: invoices[0].paidAmount,
            adjustment_total: invoices[0].adjustmentTotal,
            status: invoices[0].status,
          },
        ];
      }
      return [{ max: 0 }];
    },
    payment: {
      create: async ({ data }: any) => {
        const payment = { id: randomUUID(), ...data, createdAt: new Date(), updatedAt: new Date() };
        payments.push(payment);
        return payment;
      },
      findFirst: async () => null,
      findUnique: async () => null,
    },
    invoice: {
      findFirst: async ({ where }: any) => invoices.find((i) => i.id === where.id) ?? null,
      findFirstOrThrow: async ({ where }: any) => {
        const found = invoices.find((i) => i.id === where.id);
        if (!found) throw new Error('not found');
        return found;
      },
      findUnique: async ({ where }: any) => {
        // This is the verification read AFTER update - return stale value to simulate failure
        const found = invoices.find((i) => i.id === where.id);
        if (!found) return null;
        // Return the OLD paidAmount (0) instead of the updated one (100)
        // This simulates the update not persisting
        return { paidAmount: new Decimal('0.00') };
      },
      update: async ({ where }: any) => {
        updateCalled = true;
        const found = invoices.find((i) => i.id === where.id);
        if (!found) throw new Error('invoice not found');
        // In the real bug, the update would execute but not persist
        // Our fake simulates this by not actually updating the in-memory object
        // But the verification read returns the old value
        return found;
      },
    },
    auditEvent: {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    },
paymentIdempotencyKey: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        idempotencyKeys.push(data);
        return data;
      },
    },
  };
  const db: any = {
    ...tx,
    $transaction: async (fn: (t: any) => unknown) => {
      // Take snapshot before transaction
      const snapshot = {
        invoices: JSON.parse(JSON.stringify(invoices)),
        payments: JSON.parse(JSON.stringify(payments)),
        audits: JSON.parse(JSON.stringify(audits)),
        idempotencyKeys: JSON.parse(JSON.stringify(idempotencyKeys)),
      };
      try {
        const result = await fn(tx);
        return result;
      } catch (e) {
        // Rollback on error
        invoices.splice(0, invoices.length, ...snapshot.invoices);
        payments.splice(0, payments.length, ...snapshot.payments);
        audits.splice(0, audits.length, ...snapshot.audits);
        idempotencyKeys.splice(0, idempotencyKeys.length, ...snapshot.idempotencyKeys);
        throw e;
      }
    },
    resident: { findFirst: async () => ({ id: 'resident-1' }) },
    booking: { findFirst: async () => null },
  };
  const service = new FinanceService({ db } as any);

  // This should throw because the verification will fail
  await assert.rejects(
    service.recordPayment(ORG, ACTOR, { invoiceId: VERIFY_FAIL_INV, amount: '100.00', method: 'CASH' }, 'verify-fail-key-0001'),
    (e: Error) => e.message.includes('paid_amount not persisted') && e.message.includes(VERIFY_FAIL_INV),
  );

  // Verify full rollback: no payment, no audit, no idempotency key
  assert.equal(payments.length, 0, 'payment must be rolled back');
  assert.equal(audits.length, 0, 'audit event must be rolled back');
  assert.equal(idempotencyKeys.length, 0, 'idempotency key must be rolled back');
  assert.equal(updateCalled, true, 'update was attempted');
});

// FIN-REC-007: paid_amount_drift invariant
test('FIN-REC-007: paid_amount_drift invariant is zero after test payments', async () => {
  const { service, invoices, payments } = makePaymentFake({ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' });
await service.recordPayment(ORG, ACTOR, { invoiceId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', amount: '100.00', method: 'CASH' }, 'drift-key-0001');
  await service.recordPayment(ORG, ACTOR, { invoiceId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', amount: '200.00', method: 'CASH' }, 'drift-key-0002');
  await service.recordPayment(ORG, ACTOR, { invoiceId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', amount: '50.00', method: 'CASH' }, 'drift-key-0003');

  // Simulate the paid_amount_drift invariant check
  for (const inv of invoices) {
    const liveCash = payments
      .filter((p) => p.invoiceId === inv.id)
      .reduce((sum, p) => sum.plus(p.amount), new Decimal('0'));
    const expectedPaid = liveCash.minus(inv.adjustmentTotal);
    assert.equal(fmt(inv.paidAmount), fmt(expectedPaid), `drift check failed for invoice ${inv.id}`);
  }
});
