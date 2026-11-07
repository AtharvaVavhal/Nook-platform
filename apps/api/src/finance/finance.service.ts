import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { resolveInstant } from '../common/time.js';
import { Prisma } from '../generated/client.js';
import {
  Decimal,
  PAYMENT_METHODS,
  daysOverdue,
  bookingCoversMonth,
  defaultDueDate,
  dueDateAtIssue,
  isMonthBillable,
  monthRangeIst,
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
  toDecimal,
  type PaymentMethodName,
} from './finance.util.js';
import { auditRequestId } from '../observability/request-context.js';

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
      // Recorded by the database when the payment was made; null on payments that pre-date the snapshot.
      creditTotalAtPayment:
        payment.creditTotalAtPayment === null || payment.creditTotalAtPayment === undefined
          ? null
          : formatMoney(payment.creditTotalAtPayment),
      balanceAfterPayment:
        payment.balanceAfterPayment === null || payment.balanceAfterPayment === undefined
          ? null
          : formatMoney(payment.balanceAfterPayment),
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
    actorUserId: string | null,
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
        requestId: auditRequestId(),
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

  /** An explicitly requested due date, or null when the rule (later of the 5th and issue date) applies. */
  private explicitDueDate(raw: unknown, periodStart: Date): Date | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const dueDate = parseDateOnly(raw, 'dueDate');
    if (dueDate.getTime() < periodStart.getTime()) {
      throw new BadRequestException('dueDate cannot be before the billing period start');
    }
    return dueDate;
  }

  /**
   * The due date an invoice carries once issued: the later of the 5th of its billing month and the
   * issue date (Asia/Kolkata). An explicitly requested later date is kept, so an explicit date can
   * postpone but never leave an invoice overdue at birth.
   */
  private issuedDueDate(periodStart: Date, issuedAt: Date, requested: Date | null): Date {
    const rule = dueDateAtIssue(periodStart, issuedAt);
    return requested && requested.getTime() > rule.getTime() ? requested : rule;
  }

  /**
   * Stays that make a resident billable for a month. Eligibility comes from the actual stay (the
   * check-in and check-out records) and the booking period [startDate, endDate) in Asia/Kolkata
   * dates, where the end date already includes any approved extension. Booking, admission and
   * resident status are not consulted: cancelling a booking or marking a resident INACTIVE or
   * ARCHIVED later must not erase months that were really occupied, and a booking cancelled before
   * any check-in has no stay. Existing invoices are skipped by the caller.
   * Newest stay first.
   */
  private async billableStays(
    db: Pick<Tx, 'checkIn'>,
    organizationId: string,
    period: ReturnType<typeof parseBillingMonth>,
    extra: Prisma.CheckInWhereInput = {},
  ) {
    const { from, to } = monthRangeIst(period);
    const day = 86_400_000;
    const rows = await db.checkIn.findMany({
      where: {
        organizationId,
        ...extra,
        checkInAt: { lt: to },
        OR: [
          { status: 'ACTIVE' },
          { checkOut: { is: { checkOutAt: { gte: from } } } },
          // CHECKED_OUT without a CheckOut row: the status change time is the only record.
          { status: 'CHECKED_OUT', checkOut: { is: null }, updatedAt: { gte: from } },
        ],
        // Coarse database pre-filter (one day of slack); the exact test is bookingCoversMonth below.
        booking: {
          is: {
            startDate: { lt: new Date(period.nextPeriodStart.getTime() + day) },
            endDate: { gt: new Date(period.periodStart.getTime() - day) },
          },
        },
      },
      orderBy: [{ checkInAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        residentId: true,
        status: true,
        checkInAt: true,
        updatedAt: true,
        checkOut: { select: { checkOutAt: true } },
        booking: { select: { id: true, monthlyPrice: true, startDate: true, endDate: true } },
      },
    });
    return rows.filter((row) =>
      isMonthBillable(
        {
          checkInAt: row.checkInAt,
          status: row.status,
          checkOutAt: row.checkOut?.checkOutAt ?? null,
          updatedAt: row.updatedAt,
        },
        row.booking,
        period,
      ),
    );
  }

  // --------------------------------------------------------------- invoices

  async createDraft(organizationId: string, actorUserId: string, body: unknown) {
    const input = asObject(body);
    if (input.amount !== undefined) {
      throw new BadRequestException(
        'amount cannot be set: the invoice amount comes from the booking monthly price. ' +
          'Use a credit adjustment to correct an issued invoice.',
      );
    }
    const residentId = requireUuid(input.residentId, 'residentId');
    if (input.bookingId === undefined || input.bookingId === null) {
      throw new BadRequestException('bookingId is required: the amount comes from the booking');
    }
    const bookingId = requireUuid(input.bookingId, 'bookingId');
    const period = parseBillingMonth(input.month);
    this.assertBillableMonth(period.periodStart);
    const dueDate =
      this.explicitDueDate(input.dueDate, period.periodStart) ?? defaultDueDate(period.periodStart);
    const notes = optionalText(input.notes, 'notes', 1000);

    const resident = await this.prisma.db.resident.findFirst({
      where: { id: residentId, organizationId },
      select: { id: true },
    });
    if (!resident) throw new NotFoundException('Resident not found');

    const booking = await this.prisma.db.booking.findFirst({
      where: { id: bookingId, organizationId, residentId },
      select: { monthlyPrice: true, startDate: true, endDate: true },
    });
    if (!booking) throw new NotFoundException('Booking not found for this resident');
    if (!bookingCoversMonth(booking, period)) {
      throw new BadRequestException(
        'The booking does not cover this billing month (the booking end date is exclusive); ' +
          'an approved extension is required to bill beyond it',
      );
    }
    const stays = await this.billableStays(this.prisma.db, organizationId, period, {
      bookingId,
      residentId,
    });
    if (stays.length === 0) {
      throw new BadRequestException(
        'There is no recorded stay for this booking in this billing month',
      );
    }
    // Price snapshot: the booking's monthly price, charged in full (no proration).
    const invoiceAmount = booking.monthlyPrice;
    if (!invoiceAmount.gt(0)) {
      throw new BadRequestException('The booking has no positive monthly price to invoice');
    }

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        await this.lockNumbering(tx, organizationId);
        // A legacy invoice (no booking) already bills this resident for the month: do not bill it a second time.
        const legacy = await tx.invoice.findFirst({
          where: {
            organizationId,
            residentId,
            periodStart: period.periodStart,
            bookingId: null,
            status: { not: 'CANCELLED' },
          },
          select: { id: true },
        });
        if (legacy) {
          throw new ConflictException(
            'An active invoice without a booking already exists for this resident and billing period',
          );
        }
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
        // One ACTIVE invoice per booking per billing month. A voided invoice does not count: it can be replaced.
        throw new ConflictException(
          'An active invoice already exists for this booking and billing period',
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
      const draft = await tx.invoice.findFirstOrThrow({
        where: { id: invoiceId, organizationId },
        select: { periodStart: true, dueDate: true },
      });
      // The due date is fixed here, at issue: later of the 5th and the issue date. A draft that
      // carries an explicit later date keeps it.
      const issuedAt = new Date();
      const requested =
        draft.dueDate.getTime() === defaultDueDate(draft.periodStart).getTime()
          ? null
          : draft.dueDate;
      const dueDate = this.issuedDueDate(draft.periodStart, issuedAt, requested);
      const invoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'ISSUED', issuedAt, dueDate },
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
          dueDate: isoDate(dueDate),
        },
      );
      return this.serializeInvoice(invoice, todayIst());
    }, TX_OPTIONS);
  }

  /**
   * Idempotent and concurrency-safe: numbering is serialised per organization, existing
   * (resident, period) invoices are skipped, and the unique index is the final backstop.
   * Rent is always the booking's full monthlyPrice, never prorated for partial months.
   * Eligibility is stay-based (see billableStays). Each invoice issued here writes its own
   * `finance.invoice.issued` audit event in the same transaction, plus one batch event.
   */
  /**
   * What monthly generation would do for one organization and month: the billable bookings, which of them still need an
   * invoice, and how many are skipped. Reads only. One invoice per BOOKING per period: a booking has at most one admission and
   * one check-in, so each billable stay is exactly one booking, and separate bookings of one resident (a bed transfer, say) are
   * billed independently. Only ACTIVE invoices occupy a slot: a voided one has been replaced or is waiting to be, and a legacy
   * invoice with no booking already bills its resident for the month.
   */
  private async planMonthly(
    db: Pick<Tx, 'checkIn' | 'invoice'>,
    organizationId: string,
    period: ReturnType<typeof parseBillingMonth>,
  ) {
    const stays = await this.billableStays(db, organizationId, period);
    const byBooking = new Map<string, { residentId: string; amount: Decimal }>();
    for (const row of stays) {
      if (!byBooking.has(row.booking.id)) {
        byBooking.set(row.booking.id, {
          residentId: row.residentId,
          amount: row.booking.monthlyPrice,
        });
      }
    }
    const existing = await db.invoice.findMany({
      where: { organizationId, periodStart: period.periodStart, status: { not: 'CANCELLED' } },
      select: { bookingId: true, residentId: true },
    });
    const billedBookings = new Set(
      existing.flatMap((row) => (row.bookingId ? [row.bookingId] : [])),
    );
    const legacyResidents = new Set(
      existing.filter((row) => !row.bookingId).map((row) => row.residentId),
    );
    const toCreate: Array<{ residentId: string; bookingId: string; amount: Decimal }> = [];
    let skippedZeroPrice = 0;
    for (const [bookingId, candidate] of byBooking) {
      if (billedBookings.has(bookingId) || legacyResidents.has(candidate.residentId)) continue;
      if (!candidate.amount.gt(0)) {
        skippedZeroPrice += 1;
        continue;
      }
      toCreate.push({ bookingId, ...candidate });
    }
    return { byBooking, toCreate, skippedZeroPrice };
  }

  /** The same plan as generateMonthly, without writing anything (used by the scheduler's dry run). */
  async previewMonthly(organizationId: string, month: unknown) {
    const period = parseBillingMonth(month);
    this.assertBillableMonth(period.periodStart);
    const { byBooking, toCreate, skippedZeroPrice } = await this.planMonthly(
      this.prisma.db,
      organizationId,
      period,
    );
    return {
      month: period.month,
      eligibleBookings: byBooking.size,
      wouldCreate: toCreate.length,
      skippedExisting: byBooking.size - toCreate.length - skippedZeroPrice,
      skippedZeroPrice,
    };
  }

  /**
   * `actorUserId` is null for the scheduler (the system actor); `options.source` names who triggered the run in the audit
   * metadata ('generate-monthly' for the API, 'scheduler' for the job).
   */
  async generateMonthly(
    organizationId: string,
    actorUserId: string | null,
    body: unknown,
    options: { source?: string } = {},
  ) {
    const source = options.source ?? 'generate-monthly';
    const input = asObject(body);
    const period = parseBillingMonth(input.month);
    this.assertBillableMonth(period.periodStart);
    const requestedDue = this.explicitDueDate(input.dueDate, period.periodStart);
    if (input.issue !== undefined && typeof input.issue !== 'boolean') {
      throw new BadRequestException('issue must be a boolean');
    }
    const issueNow = input.issue === true;

    return this.prisma.db.$transaction(async (tx) => {
      await this.lockNumbering(tx, organizationId);

      const { byBooking, toCreate, skippedZeroPrice } = await this.planMonthly(
        tx,
        organizationId,
        period,
      );

      const year = billingYearIst();
      let sequence = await this.lastSequence(tx, organizationId, year);
      const issuedAt = issueNow ? new Date() : null;
      const dueDate = issuedAt
        ? this.issuedDueDate(period.periodStart, issuedAt, requestedDue)
        : (requestedDue ?? defaultDueDate(period.periodStart));
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
            source,
          },
        );
        if (issueNow) {
          // Exactly one issued event per invoice this run actually created. A retry finds the
          // invoices already present, creates none, and therefore writes no further events.
          for (const invoice of invoices) {
            await this.audit(
              tx,
              organizationId,
              actorUserId,
              'finance.invoice.issued',
              'invoice',
              invoice.id,
              {
                number: invoice.number,
                automatic: true,
                source,
                month: period.month,
                dueDate: isoDate(invoice.dueDate),
              },
            );
          }
        }
      }

      const today = todayIst();
      return {
        month: period.month,
        eligibleBookings: byBooking.size,
        // kept for existing clients: the distinct residents behind the eligible bookings
        eligibleResidents: new Set([...byBooking.values()].map((candidate) => candidate.residentId))
          .size,
        created: created.count,
        skippedExisting: byBooking.size - toCreate.length - skippedZeroPrice,
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
        voids: { include: { actor: { select: { displayName: true } } } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const voidRecord = invoice.voids[0];
    return {
      ...this.serializeInvoice(invoice, todayIst()),
      payments: invoice.payments.map((payment) => this.serializePayment(payment)),
      adjustments: invoice.adjustments.map((adjustment) => this.serializeAdjustment(adjustment)),
      void: voidRecord
        ? {
            id: voidRecord.id,
            reason: voidRecord.reason,
            voidedAt: voidRecord.createdAt.toISOString(),
            voidedBy: voidRecord.actor.displayName,
            previousStatus: voidRecord.previousStatus,
            amountAtVoid: formatMoney(voidRecord.amountAtVoid),
          }
        : null,
      // Cancelled before void records existed: kept as it was, with no void record invented for it.
      legacyCancelled: invoice.status === 'CANCELLED' && !voidRecord,
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
    // A zone-less receivedAt (or a bare date) is Asia/Kolkata wall-clock time, never the host's.
    const receivedAt = resolveInstant(input.receivedAt, 'receivedAt');
    if (receivedAt.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException('receivedAt cannot be in the future');
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
      // DEFENSIVE: Verify the paid_amount update persisted before emitting the audit event.
      // If the update was lost (e.g., due to a transaction boundary issue), throw to roll back
      // the entire transaction rather than creating an audit event for a payment the invoice
      // does not reflect.
      const verify = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { paidAmount: true },
      });
      if (!verify) {
        throw new Error(
          `Invoice ${invoiceId} not found after payment; payment row exists but invoice update vanished.`,
        );
      }
      if (!verify.paidAmount.equals(newPaid)) {
        throw new Error(
          `Invoice ${invoiceId} paid_amount not persisted: expected ${formatMoney(newPaid)}, found ${formatMoney(verify.paidAmount)}.`,
        );
      }
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

  /**
   * Voids an invoice: an append-only record plus a move to CANCELLED, in one transaction. Voiding is
   * terminal. It is refused while payments are unreversed or credits are applied (credits are append-only
   * and cannot be reversed), and it never touches payments, reversals or credits. A draft may be voided
   * too. The database re-checks every rule, so a race cannot slip a void past a payment.
   */
  async voidInvoice(organizationId: string, actorUserId: string, invoiceId: string, body: unknown) {
    const reason = parseReason(asObject(body).reason);
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const locked = await this.lockInvoice(tx, organizationId, invoiceId);
        if (locked.status === 'CANCELLED') {
          throw new ConflictException('This invoice is already voided');
        }
        const problems: string[] = [];
        if (locked.adjustmentTotal.lt(0)) {
          problems.push(
            'it has credits applied, which cannot be reversed (correct it with a further credit instead)',
          );
        }
        if (locked.paidAmount.plus(locked.adjustmentTotal).gt(0)) {
          problems.push('it has unreversed payments (reverse each payment, with a reason, first)');
        }
        if (problems.length > 0) {
          throw new ConflictException(`This invoice cannot be voided: ${problems.join('; and ')}`);
        }
        const record = await tx.invoiceVoid.create({
          data: {
            organizationId,
            invoiceId,
            residentId: locked.residentId,
            // Overwritten by the database from the locked invoice; sent only to satisfy the client types.
            previousStatus: locked.status as Prisma.InvoiceVoidCreateInput['previousStatus'],
            amountAtVoid: locked.amount,
            reason,
            voidedBy: actorUserId,
          },
          include: { actor: { select: { displayName: true } } },
        });
        const invoice = await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: 'CANCELLED' },
          include: { resident: { select: { id: true, firstName: true, lastName: true } } },
        });
        await this.audit(
          tx,
          organizationId,
          actorUserId,
          'finance.invoice.voided',
          'invoice',
          invoiceId,
          {
            number: invoice.number,
            reason,
            previousStatus: record.previousStatus,
            amount: formatMoney(record.amountAtVoid),
          },
        );
        return {
          invoice: this.serializeInvoice(invoice, todayIst()),
          void: {
            id: record.id,
            reason: record.reason,
            voidedAt: record.createdAt.toISOString(),
            voidedBy: record.actor.displayName,
            previousStatus: record.previousStatus,
            amountAtVoid: formatMoney(record.amountAtVoid),
          },
        };
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This invoice is already voided');
      }
      throw error;
    }
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
          const range = monthRangeIst(period);
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
                receivedAt: { gte: range.from, lt: range.to },
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
      // A recorded snapshot is the figure the receipt showed when it was issued and is never recomputed.
      // Payments that pre-date the snapshot keep the old derived figure, labelled as derived.
      const recorded =
        payment.balanceAfterPayment !== null && payment.creditTotalAtPayment !== null;
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
        balanceAfterPayment: recorded
          ? formatMoney(payment.balanceAfterPayment as Decimal)
          : formatMoney(netDue.minus(cumulative)),
        creditTotalAtPayment: recorded
          ? formatMoney(payment.creditTotalAtPayment as Decimal)
          : null,
        balanceSource: recorded ? ('recorded' as const) : ('derived' as const),
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
