import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal, todayIst } from '../finance/finance.util.js';
import { FinanceService, OPEN_STATUSES } from '../finance/finance.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ResidentAuthContext } from '../resident-auth/resident-auth.types.js';
import { StaySummaryService } from '../stay-summary/stay-summary.service.js';
import {
  INVOICE_SELECT,
  PAYMENT_SELECT,
  RESIDENT_VISIBLE_INVOICE_STATUSES,
  emptyStay,
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
} from './resident-self.dto.js';

/**
 * Read-only resident self-service. Identity is the server-side session context (ResidentAuthContext) and nothing else: no method
 * accepts a resident or organization id from the caller, and every query carries both as database filters, so a record that
 * belongs to anyone else is simply not found. Nothing here writes, and the financial and allocation logic is the existing
 * services' (FinanceService, StaySummaryService); this class selects and shapes.
 */
@Injectable()
export class ResidentSelfService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StaySummaryService) private readonly staySummary: StaySummaryService,
    @Inject(FinanceService) private readonly finance: FinanceService,
  ) {}

  private visibleInvoices(ctx: ResidentAuthContext) {
    return {
      organizationId: ctx.organizationId,
      residentId: ctx.residentId,
      status: { in: [...RESIDENT_VISIBLE_INVOICE_STATUSES] },
    };
  }

  async profile(ctx: ResidentAuthContext) {
    const account = await this.prisma.db.residentAccount.findFirst({
      where: { id: ctx.accountId, residentId: ctx.residentId, organizationId: ctx.organizationId },
      select: {
        phoneE164: true,
        status: true,
        createdAt: true,
        resident: { select: { firstName: true, lastName: true, status: true } },
        organization: { select: { name: true } },
      },
    });
    if (!account) throw notFound();
    return toProfileDto(account);
  }

  async stay(ctx: ResidentAuthContext) {
    try {
      const summary = await this.staySummary.getStaySummary(ctx.organizationId, ctx.residentId);
      return toStayDto(summary, ctx.organizationName);
    } catch (error) {
      // The allocation logic refuses to guess when records disagree; a resident sees "under review", never the internal detail.
      if (error instanceof ConflictException) return emptyStay('UNDER_REVIEW');
      if (error instanceof NotFoundException) throw notFound();
      throw error;
    }
  }

  async rentSummary(ctx: ResidentAuthContext) {
    const where = this.visibleInvoices(ctx);
    const today = todayIst();
    const [billed, outstanding, next] = await Promise.all([
      this.prisma.db.invoice.aggregate({
        where,
        _sum: { amount: true, paidAmount: true },
        _count: true,
      }),
      // The owner side's own outstanding/overdue calculation, restricted to this resident by the session.
      this.finance.outstanding(ctx.organizationId, { residentId: ctx.residentId, limit: 1 }),
      this.prisma.db.invoice.findFirst({
        where: {
          organizationId: ctx.organizationId,
          residentId: ctx.residentId,
          status: { in: [...OPEN_STATUSES] },
          dueDate: { gte: today },
        },
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
        select: { dueDate: true },
      }),
    ]);
    const zero = new Decimal(0);
    return toRentSummaryDto({
      invoiced: billed._sum.amount ?? zero,
      paid: billed._sum.paidAmount ?? zero,
      invoiceCount: billed._count,
      outstanding: outstanding.totals.outstandingAmount,
      overdue: outstanding.totals.overdueAmount,
      nextDueDate: next?.dueDate ?? null,
    });
  }

  async invoices(ctx: ResidentAuthContext, query: unknown) {
    const { page, limit } = parseResidentPagination(query);
    const where = this.visibleInvoices(ctx);
    const today = todayIst();
    const [rows, total] = await Promise.all([
      this.prisma.db.invoice.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ periodStart: 'desc' }, { number: 'desc' }],
        select: INVOICE_SELECT,
      }),
      this.prisma.db.invoice.count({ where }),
    ]);
    return toPage(
      rows.map((row) => toInvoiceDto(row, today)),
      total,
      page,
      limit,
    );
  }

  async invoice(ctx: ResidentAuthContext, id: string) {
    const row = await this.prisma.db.invoice.findFirst({
      where: { id, ...this.visibleInvoices(ctx) },
      select: {
        ...INVOICE_SELECT,
        payments: { orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }], select: PAYMENT_SELECT },
      },
    });
    if (!row) throw notFound();
    return toInvoiceDetailDto(row, todayIst());
  }

  async payments(ctx: ResidentAuthContext, query: unknown) {
    const { page, limit } = parseResidentPagination(query);
    const where = {
      organizationId: ctx.organizationId,
      residentId: ctx.residentId,
      invoice: { status: { in: [...RESIDENT_VISIBLE_INVOICE_STATUSES] } },
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.payment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        select: { ...PAYMENT_SELECT, invoice: { select: { id: true, number: true } } },
      }),
      this.prisma.db.payment.count({ where }),
    ]);
    return toPage(rows.map(toPaymentDto), total, page, limit);
  }

  /** `id` is the payment id (the receipt number is `RCPT-<payment id>`). Ownership is checked in the query before the receipt is built. */
  async receipt(ctx: ResidentAuthContext, paymentId: string) {
    const payment = await this.prisma.db.payment.findFirst({
      where: {
        id: paymentId,
        organizationId: ctx.organizationId,
        residentId: ctx.residentId,
        invoice: { status: { in: [...RESIDENT_VISIBLE_INVOICE_STATUSES] } },
      },
      select: { invoiceId: true },
    });
    if (!payment) throw notFound();
    try {
      const built = await this.finance.receipt(ctx.organizationId, payment.invoiceId, paymentId);
      return toReceiptDto(built, ctx.displayName);
    } catch (error) {
      if (error instanceof NotFoundException) throw notFound();
      throw error;
    }
  }
}
