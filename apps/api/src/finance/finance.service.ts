import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/client.js';
import {
  Decimal,
  PAYMENT_METHODS,
  daysOverdue,
  defaultDueDate,
  effectiveStatus,
  formatInvoiceNumber,
  formatMoney,
  isoDate,
  parseBillingMonth,
  parseDateOnly,
  parseCredit,
  parseMoney,
  parsePage,
  parseReason,
  receiptNumber,
  shiftMonth,
  statusAfterCorrection,
  statusAfterPayment,
  todayIst,
  billingYearIst,
  istStartOfDay,
  toDecimal,
  type PaymentMethodName,
} from './finance.util.js';

const OPEN_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] as const;
const BILLABLE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'] as const;
const MAX_REPORT_MONTHS = 12;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new BadRequestException(
      'Idempotency-Key header is required (8-128 characters: letters, digits, _ . : -)',
    );
  }
  return value;
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

type Tx = Prisma.TransactionClient;

type PaymentWithReversal = Prisma.PaymentGetPayload<object> & {
  reversals?: Array<
    Prisma.PaymentReversalGetPayload<object> & { actor?: { displayName: string } | null }
  >;
};
type AdjustmentWithActor = Prisma.InvoiceAdjustmentGetPayload<object> & {
  actor?: { displayName: string } | null;
};

const REVERSAL_INCLUDE = { include: { actor: { select: { displayName: true } } } } as const;

type InvoiceWithResident = Prisma.InvoiceGetPayload<{
  include: { resident: { select: { id: true; firstName: true; lastName: true } } };
}>;

interface LockedInvoiceRow {
  id: string;
  resident_id: string;
  amount: Prisma.Decimal | string;
  paid_amount: Prisma.Decimal | string;
  adjustment_total: Prisma.Decimal | string;
  status: string;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function requireUuid(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new BadRequestException(`${field} must be a valid UUID`);
  }
  return value;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max)
    throw new BadRequestException(`${field} must be at most ${max} characters`);
  return trimmed.length ? trimmed : null;
}

function residentName(resident: { firstName: string; lastName: string }): string {
  return `${resident.firstName} ${resident.lastName}`.trim();
}

@Injectable()
export class FinanceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- helpers

  /**
   * Serialises invoice numbering per organization for the rest of the transaction.
   * The (organization_id, number) unique index remains the database-level backstop.
   */
  private async lockNumbering(tx: Tx, organizationId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invoice-number:${organizationId}`}, 0))`;
  }

  private async lastSequence(tx: Tx, organizationId: string, year: number): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ max: number | bigint }>>`
      SELECT COALESCE(MAX(CAST(SUBSTRING(number FROM 10) AS INTEGER)), 0) AS max
      FROM invoices
      WHERE organization_id = ${organizationId}::uuid AND number LIKE ${`INV-${year}-%`}`;
    return Number(rows[0]?.max ?? 0);
  }

  private async lockInvoice(tx: Tx, organizationId: string, invoiceId: string) {
    const rows = await tx.$queryRaw<LockedInvoiceRow[]>`
      SELECT id, resident_id, amount, paid_amount, adjustment_total, status
      FROM invoices
      WHERE id = ${invoiceId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new NotFoundException('Invoice not found');
    return {
      id: row.id,
      residentId: row.resident_id,
      amount: toDecimal(row.amount),
      paidAmount: toDecimal(row.paid_amount),
      adjustmentTotal: toDecimal(row.adjustment_total),
      status: row.status,
    };
  }

  private serializeInvoice(invoice: InvoiceWithResident, today: Date) {
    const balance = invoice.amount.minus(invoice.paidAmount);
    const status = effectiveStatus(invoice.status, invoice.dueDate, today);
    return {
      id: invoice.id,
      number: invoice.number,
      residentId: invoice.residentId,
      residentName: residentName(invoice.resident),
      bookingId: invoice.bookingId,
      periodStart: isoDate(invoice.periodStart),
      periodEnd: isoDate(invoice.periodEnd),
      amount: formatMoney(invoice.amount),
      paidAmount: formatMoney(invoice.paidAmount),
      adjustmentTotal: formatMoney(invoice.adjustmentTotal),
      cashReceived: formatMoney(invoice.paidAmount.plus(invoice.adjustmentTotal)),
      balance: formatMoney(balance),
      status,
      storedStatus: invoice.status,
      isOverdue: status === 'OVERDUE',
      daysOverdue: status === 'OVERDUE' ? daysOverdue(invoice.dueDate, today) : 0,
      dueDate: isoDate(invoice.dueDate),
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      notes: invoice.notes,
      createdAt: invoice.createdAt.toISOString(),
    };
  }

  private serializePayment(payment: PaymentWithReversal) {
    const reversal = payment.reversals?.[0];
    return {
      id: payment.id,
      invoiceId: payment.invoiceId,
      receiptNumber: receiptNumber(payment.id),
      amount: formatMoney(payment.amount),
      method: payment.method,
      reference: payment.reference,
      receivedAt: payment.receivedAt.toISOString(),
      notes: payment.notes,
      correctsPaymentId: payment.correctsPaymentId,
      reversed: Boolean(reversal),
      reversal: reversal
        ? {
            id: reversal.id,
            reason: reversal.reason,
            reversedAt: reversal.createdAt.toISOString(),
            reversedBy: reversal.actor?.displayName ?? null,
          }
        : null,
      createdAt: payment.createdAt.toISOString(),
    };
  }

  private serializeAdjustment(adjustment: AdjustmentWithActor) {
    return {
      id: adjustment.id,
      invoiceId: adjustment.invoiceId,
      amount: formatMoney(adjustment.amount),
      reason: adjustment.reason,
      createdBy: adjustment.actor?.displayName ?? null,
      createdAt: adjustment.createdAt.toISOString(),
    };
  }

  private async audit(
    tx: Tx,
    organizationId: string,
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    await tx.auditEvent.create({
      data: {
        organizationId,
        actorUserId,
        action,
        targetType,
        targetId,
        requestId: randomUUID(),
        metadata,
      },
    });
  }

  private assertBillableMonth(periodStart: Date): void {
    const today = todayIst();
    const limit = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    if (periodStart.getTime() > limit.getTime()) {
      throw new BadRequestException('Billing month cannot be later than next month');
    }
  }

  private resolveDueDate(raw: unknown, periodStart: Date): Date {
    if (raw === undefined || raw === null || raw === '') return defaultDueDate(periodStart);
    const dueDate = parseDateOnly(raw, 'dueDate');
    if (dueDate.getTime() < periodStart.getTime()) {
      throw new BadRequestException('dueDate cannot be before the billing period start');
    }
    return dueDate;
  }

  // --------------------------------------------------------------- invoices

  async createDraft(organizationId: string, actorUserId: string, body: unknown) {
    const input = asObject(body);
    const residentId = requireUuid(input.residentId, 'residentId');
    const bookingId =
      input.bookingId === undefined || input.bookingId === null
        ? null
        : requireUuid(input.bookingId, 'bookingId');
    const period = parseBillingMonth(input.month);
    this.assertBillableMonth(period.periodStart);
    const dueDate = this.resolveDueDate(input.dueDate, period.periodStart);
    const notes = optionalText(input.notes, 'notes', 1000);

    const resident = await this.prisma.db.resident.findFirst({
      where: { id: residentId, organizationId },
      select: { id: true },
    });
    if (!resident) throw new NotFoundException('Resident not found');

    let amount: Decimal | null = null;
    if (bookingId) {
      const booking = await this.prisma.db.booking.findFirst({
        where: { id: bookingId, organizationId, residentId },
        select: { monthlyPrice: true, status: true },
      });
      if (!booking) throw new NotFoundException('Booking not found for this resident');
      if (booking.status !== 'CONFIRMED') {
        throw new BadRequestException('Cannot invoice a cancelled booking');
      }
      // Price snapshot: the booking's monthly price, charged in full (no proration).
      amount = booking.monthlyPrice;
    }
    if (input.amount !== undefined && input.amount !== null) {
      amount = parseMoney(input.amount, 'amount');
    }
    if (!amount || !amount.gt(0)) {
      throw new BadRequestException(
        'amount is required (or supply a booking with a positive monthly price)',
      );
    }
    const invoiceAmount = amount;

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        await this.lockNumbering(tx, organizationId);
        const year = billingYearIst();
        const sequence = (await this.lastSequence(tx, organizationId, year)) + 1;
        const invoice = await tx.invoice.create({
          data: {
            organizationId,
            residentId,
            bookingId,
            number: formatInvoiceNumber(year, sequence),
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            amount: invoiceAmount,
            dueDate,
            notes,
            status: 'DRAFT',
          },
          include: { resident: { select: { id: true, firstName: true, lastName: true } } },
        });
        await this.audit(
          tx,
          organizationId,
          actorUserId,
          'finance.invoice.created',
          'invoice',
          invoice.id,
          {
            number: invoice.number,
            amount: formatMoney(invoice.amount),
          },
        );
        return this.serializeInvoice(invoice, todayIst());
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'An invoice already exists for this resident and billing period',
        );
      }
      throw error;
    }
  }

  async issue(organizationId: string, actorUserId: string, invoiceId: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const locked = await this.lockInvoice(tx, organizationId, invoiceId);
      if (locked.status !== 'DRAFT') {
        throw new ConflictException(
          `Only DRAFT invoices can be issued (current status: ${locked.status})`,
        );
      }
      const invoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'ISSUED', issuedAt: new Date() },
        include: { resident: { select: { id: true, firstName: true, lastName: true } } },
      });
      await this.audit(
        tx,
        organizationId,
        actorUserId,
        'finance.invoice.issued',
        'invoice',
        invoiceId,
        {
          number: invoice.number,
        },
      );
      return this.serializeInvoice(invoice, todayIst());
    }, TX_OPTIONS);
  }

  /**
   * Idempotent and concurrency-safe: numbering is serialised per organization, existing
   * (resident, period) invoices are skipped, and the unique index is the final backstop.
   * Rent is always the booking's full monthlyPrice — never prorated for partial months.
   */
  async generateMonthly(organizationId: string, actorUserId: string, body: unknown) {
    const input = asObject(body);
    const period = parseBillingMonth(input.month);
    this.assertBillableMonth(period.periodStart);
    const dueDate = this.resolveDueDate(input.dueDate, period.periodStart);
    if (input.issue !== undefined && typeof input.issue !== 'boolean') {
      throw new BadRequestException('issue must be a boolean');
    }
    const issueNow = input.issue === true;

    return this.prisma.db.$transaction(async (tx) => {
      await this.lockNumbering(tx, organizationId);

      const checkIns = await tx.checkIn.findMany({
        where: {
          organizationId,
          // Month boundaries are Asia/Kolkata midnights. A resident who checks out during the month
          // (or the day it starts) is still billed the full month; only a checkout completed before
          // the period began excludes them.
          checkInAt: { lt: istStartOfDay(period.nextPeriodStart) },
          OR: [
            { status: 'ACTIVE' },
            {
              checkOut: { is: { checkOutAt: { gte: istStartOfDay(period.periodStart) } } },
            },
            // CHECKED_OUT through update/cancel leaves no CheckOut row; the status change time
            // is then the only checkout moment on record.
            {
              status: 'CHECKED_OUT',
              checkOut: { is: null },
              updatedAt: { gte: istStartOfDay(period.periodStart) },
            },
          ],
          admission: { is: { status: 'ADMITTED' } },
          resident: { is: { status: 'ACTIVE' } },
          booking: {
            is: {
              status: 'CONFIRMED',
              startDate: { lt: period.nextPeriodStart },
              endDate: { gte: period.periodStart },
            },
          },
        },
        orderBy: { checkInAt: 'desc' },
        select: {
          residentId: true,
          booking: { select: { id: true, monthlyPrice: true } },
        },
      });

      // One invoice per resident per period: the most recent eligible check-in wins.
      const byResident = new Map<string, { bookingId: string; amount: Decimal }>();
      for (const row of checkIns) {
        if (!byResident.has(row.residentId)) {
          byResident.set(row.residentId, {
            bookingId: row.booking.id,
            amount: row.booking.monthlyPrice,
          });
        }
      }

      const existing = await tx.invoice.findMany({
        where: { organizationId, periodStart: period.periodStart },
        select: { residentId: true },
      });
      const existingResidents = new Set(existing.map((row) => row.residentId));

      const toCreate: Array<{ residentId: string; bookingId: string; amount: Decimal }> = [];
      let skippedZeroPrice = 0;
      for (const [residentId, candidate] of byResident) {
        if (existingResidents.has(residentId)) continue;
        if (!candidate.amount.gt(0)) {
          skippedZeroPrice += 1;
          continue;
        }
        toCreate.push({ residentId, ...candidate });
      }

      const year = billingYearIst();
      let sequence = await this.lastSequence(tx, organizationId, year);
      const issuedAt = issueNow ? new Date() : null;
      const numbers: string[] = [];
      const rows = toCreate.map((item) => {
        sequence += 1;
        const number = formatInvoiceNumber(year, sequence);
        numbers.push(number);
        return {
          organizationId,
          residentId: item.residentId,
          bookingId: item.bookingId,
          number,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          amount: item.amount,
          dueDate,
          status: issueNow ? ('ISSUED' as const) : ('DRAFT' as const),
          issuedAt,
        };
      });

      const created = rows.length
        ? await tx.invoice.createMany({ data: rows, skipDuplicates: true })
        : { count: 0 };

      const invoices = numbers.length
        ? await tx.invoice.findMany({
            where: { organizationId, number: { in: numbers } },
            include: { resident: { select: { id: true, firstName: true, lastName: true } } },
            orderBy: { number: 'asc' },
          })
        : [];

      if (created.count > 0) {
        await this.audit(
          tx,
          organizationId,
          actorUserId,
          'finance.invoices.generated',
          'invoice_batch',
          period.month,
          {
            month: period.month,
            created: created.count,
            issued: issueNow,
          },
        );
      }

      const today = todayIst();
      return {
        month: period.month,
        eligibleResidents: byResident.size,
        created: created.count,
        skippedExisting: byResident.size - toCreate.length - skippedZeroPrice,
        skippedZeroPrice,
        invoices: invoices.map((invoice) => this.serializeInvoice(invoice, today)),
      };
    }, TX_OPTIONS);
  }

  private invoiceFilter(organizationId: string, query: Record<string, unknown>, today: Date) {
    const where: Prisma.InvoiceWhereInput = { organizationId };
    const and: Prisma.InvoiceWhereInput[] = [];

    if (typeof query.residentId === 'string' && query.residentId) {
      where.residentId = requireUuid(query.residentId, 'residentId');
    }
    if (typeof query.month === 'string' && query.month) {
      where.periodStart = parseBillingMonth(query.month).periodStart;
    }
    if (typeof query.search === 'string' && query.search.trim()) {
      const search = query.search.trim().slice(0, 100);
      and.push({
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { resident: { is: { firstName: { contains: search, mode: 'insensitive' } } } },
          { resident: { is: { lastName: { contains: search, mode: 'insensitive' } } } },
        ],
      });
    }
    if (typeof query.status === 'string' && query.status) {
      const status = query.status;
      const allowed = ['DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED'];
      if (!allowed.includes(status)) throw new BadRequestException('Invalid status filter');
      if (status === 'OVERDUE') {
        and.push({ status: { in: [...OPEN_STATUSES] }, dueDate: { lt: today } });
      } else if (status === 'ISSUED' || status === 'PARTIALLY_PAID') {
        and.push({ status, dueDate: { gte: today } });
      } else {
        and.push({ status: status as 'DRAFT' | 'PAID' | 'CANCELLED' });
      }
    }
    if (and.length) where.AND = and;
    return where;
  }

  async findAll(organizationId: string, query: Record<string, unknown>) {
    const page = parsePage(query.page, 1, 100_000, 'page');
    const limit = parsePage(query.limit, 20, 100, 'limit');
    const today = todayIst();
    const where = this.invoiceFilter(organizationId, query, today);

    const [items, total] = await Promise.all([
      this.prisma.db.invoice.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ periodStart: 'desc' }, { number: 'desc' }],
        include: { resident: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.db.invoice.count({ where }),
    ]);
    return {
      items: items.map((invoice) => this.serializeInvoice(invoice, today)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.db.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true } },
        payments: { orderBy: { createdAt: 'asc' }, include: { reversals: REVERSAL_INCLUDE } },
        adjustments: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { displayName: true } } },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return {
      ...this.serializeInvoice(invoice, todayIst()),
      payments: invoice.payments.map((payment) => this.serializePayment(payment)),
      adjustments: invoice.adjustments.map((adjustment) => this.serializeAdjustment(adjustment)),
    };
  }

  // --------------------------------------------------------------- payments

  async recordPayment(
    organizationId: string,
    actorUserId: string,
    body: unknown,
    idempotencyKey: unknown,
  ) {
    const key = parseIdempotencyKey(idempotencyKey);
    const input = asObject(body);
    const invoiceId = requireUuid(input.invoiceId, 'invoiceId');
    const amount = parseMoney(input.amount, 'amount');
    if (
      typeof input.method !== 'string' ||
      !PAYMENT_METHODS.includes(input.method as PaymentMethodName)
    ) {
      throw new BadRequestException(`method must be one of ${PAYMENT_METHODS.join(', ')}`);
    }
    const method = input.method as PaymentMethodName;
    const reference = optionalText(input.reference, 'reference', 200);
    const notes = optionalText(input.notes, 'notes', 1000);
    const correctsPaymentId =
      input.correctsPaymentId === undefined || input.correctsPaymentId === null
        ? null
        : requireUuid(input.correctsPaymentId, 'correctsPaymentId');
    let receivedAt = new Date();
    if (input.receivedAt !== undefined && input.receivedAt !== null && input.receivedAt !== '') {
      if (typeof input.receivedAt !== 'string' || Number.isNaN(Date.parse(input.receivedAt))) {
        throw new BadRequestException('receivedAt must be a valid ISO date');
      }
      receivedAt = new Date(input.receivedAt);
      if (receivedAt.getTime() > Date.now() + 5 * 60_000) {
        throw new BadRequestException('receivedAt cannot be in the future');
      }
    }

    const fingerprint: unknown[] = [
      invoiceId,
      formatMoney(amount),
      method,
      reference ?? null,
      notes ?? null,
      input.receivedAt ? receivedAt.toISOString() : null,
    ];
    // Appended only when present so hashes stored before corrections existed still match.
    if (correctsPaymentId) fingerprint.push(correctsPaymentId);
    const requestHash = createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');

    return this.prisma.db.$transaction(async (tx) => {
      // Same-key requests serialize here, so a concurrent duplicate waits for the first outcome.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-idempotency:${organizationId}:${key}`}, 0))`;
      const prior = await tx.paymentIdempotencyKey.findUnique({
        where: { organizationId_key: { organizationId, key } },
      });
      if (prior) {
        if (prior.requestHash !== requestHash) {
          throw new ConflictException(
            'Idempotency-Key was already used with a different payment request',
          );
        }
        return { ...(prior.response as object), idempotentReplay: true };
      }

      // Row lock + re-read: the balance below is always the latest committed state.
      const locked = await this.lockInvoice(tx, organizationId, invoiceId);
      if (locked.status === 'CANCELLED') {
        throw new BadRequestException('Cannot record a payment against a cancelled invoice');
      }
      if (locked.status === 'DRAFT') {
        throw new BadRequestException('Issue the invoice before recording payments');
      }
      if (correctsPaymentId) {
        const original = await tx.payment.findFirst({
          where: { id: correctsPaymentId, organizationId, invoiceId },
          include: { reversals: true },
        });
        if (!original) throw new NotFoundException('Payment to correct not found on this invoice');
        if (original.reversals.length === 0) {
          throw new BadRequestException('Reverse the payment before recording its replacement');
        }
        const already = await tx.payment.findUnique({ where: { correctsPaymentId } });
        if (already) throw new ConflictException('This payment already has a replacement');
      }
      const remaining = locked.amount.minus(locked.paidAmount);
      if (!remaining.gt(0)) {
        throw new BadRequestException('Invoice is already fully paid');
      }
      if (amount.gt(remaining)) {
        throw new BadRequestException(
          `Payment exceeds the remaining balance of ${formatMoney(remaining)}`,
        );
      }

      const payment = await tx.payment.create({
        data: {
          organizationId,
          invoiceId,
          residentId: locked.residentId,
          amount,
          method,
          reference,
          receivedAt,
          notes,
          correctsPaymentId,
        },
      });
      const newPaid = locked.paidAmount.plus(amount);
      const invoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: { paidAmount: newPaid, status: statusAfterPayment(locked.amount, newPaid) },
        include: { resident: { select: { id: true, firstName: true, lastName: true } } },
      });
      await this.audit(
        tx,
        organizationId,
        actorUserId,
        'finance.payment.recorded',
        'payment',
        payment.id,
        {
          invoiceId,
          amount: formatMoney(amount),
          method,
          ...(correctsPaymentId ? { correctsPaymentId } : {}),
        },
      );
      const result = {
        payment: this.serializePayment(payment),
        invoice: this.serializeInvoice(invoice, todayIst()),
      };
      await tx.paymentIdempotencyKey.create({
        data: {
          organizationId,
          key,
          requestHash,
          paymentId: payment.id,
          response: result as unknown as Prisma.InputJsonValue,
        },
      });
      return { ...result, idempotentReplay: false };
    }, TX_OPTIONS);
  }

  // ------------------------------------------------------------ corrections

  /**
   * Reverses a payment by recording an append-only reversal; the payment row itself is never
   * touched. The invoice row is locked first, the "already reversed" check happens after the lock
   * (so concurrent requests serialize), and the balance and status are recomputed from the locked
   * values in the same transaction as the audit event.
   */
  async reversePayment(
    organizationId: string,
    actorUserId: string,
    paymentId: string,
    body: unknown,
  ) {
    const reason = parseReason(asObject(body).reason);
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const payment = await tx.payment.findFirst({ where: { id: paymentId, organizationId } });
        if (!payment) throw new NotFoundException('Payment not found');
        const locked = await this.lockInvoice(tx, organizationId, payment.invoiceId);
        if (locked.status === 'CANCELLED') {
          throw new BadRequestException('Cannot reverse a payment on a cancelled invoice');
        }
        const existing = await tx.paymentReversal.findUnique({ where: { paymentId } });
        if (existing) throw new ConflictException('This payment has already been reversed');

        const balanceBefore = locked.amount.minus(locked.paidAmount);
        const newPaid = locked.paidAmount.minus(payment.amount);
        const cash = newPaid.plus(locked.adjustmentTotal);
        const status = statusAfterCorrection(locked.amount, newPaid, cash);
        const reversal = await tx.paymentReversal.create({
          data: {
            organizationId,
            paymentId,
            invoiceId: payment.invoiceId,
            reason,
            reversedBy: actorUserId,
          },
          include: { actor: { select: { displayName: true } } },
        });
        const invoice = await tx.invoice.update({
          where: { id: payment.invoiceId },
          data: { paidAmount: newPaid, status },
          include: { resident: { select: { id: true, firstName: true, lastName: true } } },
        });
        await this.audit(
          tx,
          organizationId,
          actorUserId,
          'finance.payment.reversed',
          'payment',
          paymentId,
          {
            invoiceId: payment.invoiceId,
            reversalId: reversal.id,
            reason,
            amount: formatMoney(payment.amount),
            balanceBefore: formatMoney(balanceBefore),
            balanceAfter: formatMoney(invoice.amount.minus(invoice.paidAmount)),
            statusBefore: locked.status,
            statusAfter: status,
          },
        );
        return {
          reversal: {
            id: reversal.id,
            paymentId,
            invoiceId: payment.invoiceId,
            reason: reversal.reason,
            reversedAt: reversal.createdAt.toISOString(),
            reversedBy: reversal.actor.displayName,
          },
          payment: this.serializePayment({ ...payment, reversals: [reversal] }),
          invoice: this.serializeInvoice(invoice, todayIst()),
        };
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This payment has already been reversed');
      }
      throw error;
    }
  }

  /**
   * Applies a credit (negative adjustment) to an issued, open invoice through an append-only
   * record. The issued amount is never overwritten; the credit counts toward the settled amount,
   * so balance = amount - paidAmount keeps holding. A credit larger than the remaining balance is
   * refused, so a balance can never go negative.
   */
  async adjustInvoice(
    organizationId: string,
    actorUserId: string,
    invoiceId: string,
    body: unknown,
  ) {
    const input = asObject(body);
    const amount = parseCredit(input.amount, 'amount');
    const reason = parseReason(input.reason);
    return this.prisma.db.$transaction(async (tx) => {
      const locked = await this.lockInvoice(tx, organizationId, invoiceId);
      if (locked.status === 'DRAFT') {
        throw new BadRequestException('Issue the invoice before adjusting it');
      }
      if (locked.status === 'CANCELLED') {
        throw new BadRequestException('Cannot adjust a cancelled invoice');
      }
      const balanceBefore = locked.amount.minus(locked.paidAmount);
      if (!balanceBefore.gt(0)) {
        throw new BadRequestException('Invoice is already fully settled');
      }
      const credit = amount.negated();
      if (credit.gt(balanceBefore)) {
        throw new BadRequestException(
          `Credit exceeds the remaining balance of ${formatMoney(balanceBefore)}`,
        );
      }
      const newPaid = locked.paidAmount.plus(credit);
      const newAdjustmentTotal = locked.adjustmentTotal.plus(amount);
      const cash = newPaid.plus(newAdjustmentTotal);
      const status = statusAfterCorrection(locked.amount, newPaid, cash);
      const adjustment = await tx.invoiceAdjustment.create({
        data: {
          organizationId,
          invoiceId,
          residentId: locked.residentId,
          amount,
          reason,
          createdBy: actorUserId,
        },
        include: { actor: { select: { displayName: true } } },
      });
      const invoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: { paidAmount: newPaid, adjustmentTotal: newAdjustmentTotal, status },
        include: { resident: { select: { id: true, firstName: true, lastName: true } } },
      });
      await this.audit(
        tx,
        organizationId,
        actorUserId,
        'finance.invoice.adjusted',
        'invoice',
        invoiceId,
        {
          adjustmentId: adjustment.id,
          reason,
          amount: formatMoney(amount),
          balanceBefore: formatMoney(balanceBefore),
          balanceAfter: formatMoney(invoice.amount.minus(invoice.paidAmount)),
          statusBefore: locked.status,
          statusAfter: status,
        },
      );
      return {
        adjustment: this.serializeAdjustment(adjustment),
        invoice: this.serializeInvoice(invoice, todayIst()),
      };
    }, TX_OPTIONS);
  }

  /** Newest-first history of reversals and credits across the organization. */
  async corrections(organizationId: string, query: Record<string, unknown>) {
    const limit = parsePage(query.limit, 50, 200, 'limit');
    const invoiceId =
      typeof query.invoiceId === 'string' && query.invoiceId
        ? requireUuid(query.invoiceId, 'invoiceId')
        : undefined;
    const [reversals, adjustments] = await Promise.all([
      this.prisma.db.paymentReversal.findMany({
        where: { organizationId, ...(invoiceId ? { invoiceId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          actor: { select: { displayName: true } },
          payment: { include: { invoice: { select: { number: true } } } },
        },
      }),
      this.prisma.db.invoiceAdjustment.findMany({
        where: { organizationId, ...(invoiceId ? { invoiceId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          actor: { select: { displayName: true } },
          invoice: { select: { number: true } },
        },
      }),
    ]);
    const items = [
      ...reversals.map((r) => ({
        type: 'PAYMENT_REVERSAL' as const,
        id: r.id,
        invoiceId: r.invoiceId,
        invoiceNumber: r.payment.invoice.number,
        paymentId: r.paymentId,
        amount: formatMoney(r.payment.amount),
        reason: r.reason,
        actor: r.actor.displayName,
        createdAt: r.createdAt.toISOString(),
      })),
      ...adjustments.map((a) => ({
        type: 'INVOICE_CREDIT' as const,
        id: a.id,
        invoiceId: a.invoiceId,
        invoiceNumber: a.invoice.number,
        paymentId: null,
        amount: formatMoney(a.amount),
        reason: a.reason,
        actor: a.actor.displayName,
        createdAt: a.createdAt.toISOString(),
      })),
    ]
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .slice(0, limit);
    return { items, total: items.length };
  }

  // ------------------------------------------------------------ outstanding

  async outstanding(organizationId: string, query: Record<string, unknown>) {
    const page = parsePage(query.page, 1, 100_000, 'page');
    const limit = parsePage(query.limit, 20, 100, 'limit');
    const today = todayIst();
    const where: Prisma.InvoiceWhereInput = {
      organizationId,
      status: { in: [...OPEN_STATUSES] },
    };
    if (typeof query.residentId === 'string' && query.residentId) {
      where.residentId = requireUuid(query.residentId, 'residentId');
    }
    const overdueWhere: Prisma.InvoiceWhereInput = { ...where, dueDate: { lt: today } };
    const listWhere = query.overdueOnly === 'true' ? overdueWhere : where;

    const [items, total, openSum, overdueSum] = await Promise.all([
      this.prisma.db.invoice.findMany({
        where: listWhere,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
        include: { resident: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.db.invoice.count({ where: listWhere }),
      this.prisma.db.invoice.aggregate({
        where,
        _sum: { amount: true, paidAmount: true },
        _count: true,
      }),
      this.prisma.db.invoice.aggregate({
        where: overdueWhere,
        _sum: { amount: true, paidAmount: true },
        _count: true,
      }),
    ]);
    const zero = new Decimal(0);
    const balance = (sum: { amount: Decimal | null; paidAmount: Decimal | null }) =>
      formatMoney((sum.amount ?? zero).minus(sum.paidAmount ?? zero));
    return {
      totals: {
        outstandingAmount: balance(openSum._sum),
        outstandingCount: openSum._count,
        overdueAmount: balance(overdueSum._sum),
        overdueCount: overdueSum._count,
      },
      items: items.map((invoice) => this.serializeInvoice(invoice, today)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ---------------------------------------------------------------- reports

  /**
   * invoiced   = sum of non-draft, non-cancelled invoices whose period starts in the month
   * collected  = sum of payments received in the month that have not been reversed
   *              (cash view, any invoice period; a reversal removes it from its original month)
   * outstanding/overdue = unpaid balance on that month's invoices (overdue: due date passed)
   */
  async monthlyReport(organizationId: string, query: Record<string, unknown>) {
    const end = query.month
      ? parseBillingMonth(query.month)
      : parseBillingMonth(todayIst().toISOString().slice(0, 7));
    const count = parsePage(query.months, 1, MAX_REPORT_MONTHS, 'months');
    const today = todayIst();
    const zero = new Decimal(0);

    const months = await Promise.all(
      Array.from({ length: count }, (_, index) => shiftMonth(end, index - (count - 1))).map(
        async (period) => {
          const billed: Prisma.InvoiceWhereInput = {
            organizationId,
            periodStart: period.periodStart,
            status: { in: [...BILLABLE_STATUSES] },
          };
          const [invoiced, collected, overdue] = await Promise.all([
            this.prisma.db.invoice.aggregate({
              where: billed,
              _sum: { amount: true, paidAmount: true },
              _count: true,
            }),
            this.prisma.db.payment.aggregate({
              where: {
                organizationId,
                receivedAt: { gte: period.periodStart, lt: period.nextPeriodStart },
                reversals: { none: {} },
              },
              _sum: { amount: true },
              _count: true,
            }),
            this.prisma.db.invoice.aggregate({
              where: { ...billed, status: { in: [...OPEN_STATUSES] }, dueDate: { lt: today } },
              _sum: { amount: true, paidAmount: true },
            }),
          ]);
          const invoicedTotal = invoiced._sum.amount ?? zero;
          return {
            month: period.month,
            invoiced: formatMoney(invoicedTotal),
            collected: formatMoney(collected._sum.amount ?? zero),
            outstanding: formatMoney(invoicedTotal.minus(invoiced._sum.paidAmount ?? zero)),
            overdue: formatMoney(
              (overdue._sum.amount ?? zero).minus(overdue._sum.paidAmount ?? zero),
            ),
            invoiceCount: invoiced._count,
            paymentCount: collected._count,
          };
        },
      ),
    );
    return { month: end.month, months };
  }

  // --------------------------------------------------------------- receipts

  async receipt(organizationId: string, invoiceId: string, paymentId?: string) {
    const wantedPayment = paymentId === undefined ? undefined : requireUuid(paymentId, 'paymentId');
    const invoice = await this.prisma.db.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        organization: { select: { name: true } },
        resident: { select: { id: true, firstName: true, lastName: true } },
        payments: { orderBy: { createdAt: 'asc' }, include: { reversals: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.payments.length === 0)
      throw new NotFoundException('No payments recorded for this invoice');

    let cumulative = new Decimal(0);
    const netDue = invoice.amount.plus(invoice.adjustmentTotal);
    const receipts = invoice.payments.map((payment) => {
      const reversed = payment.reversals.length > 0;
      if (!reversed) cumulative = cumulative.plus(payment.amount);
      return {
        reversed,
        reversedAt: payment.reversals[0]?.createdAt.toISOString() ?? null,
        receiptNumber: receiptNumber(payment.id),
        paymentId: payment.id,
        amount: formatMoney(payment.amount),
        method: payment.method,
        reference: payment.reference,
        receivedAt: payment.receivedAt.toISOString(),
        notes: payment.notes,
        balanceAfterPayment: formatMoney(netDue.minus(cumulative)),
      };
    });
    const selected = wantedPayment
      ? receipts.filter((r) => r.paymentId === wantedPayment)
      : receipts;
    if (selected.length === 0) throw new NotFoundException('Payment not found for this invoice');

    return {
      organizationName: invoice.organization.name,
      invoice: {
        id: invoice.id,
        number: invoice.number,
        residentName: residentName(invoice.resident),
        periodStart: isoDate(invoice.periodStart),
        periodEnd: isoDate(invoice.periodEnd),
        amount: formatMoney(invoice.amount),
        paidAmount: formatMoney(invoice.paidAmount),
        adjustmentTotal: formatMoney(invoice.adjustmentTotal),
        balance: formatMoney(invoice.amount.minus(invoice.paidAmount)),
        status: effectiveStatus(invoice.status, invoice.dueDate, todayIst()),
      },
      receipts: selected,
    };
  }
}
