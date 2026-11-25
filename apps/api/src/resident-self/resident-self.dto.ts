import { BadRequestException, NotFoundException } from '@nestjs/common';
import { maskPhone } from '../resident-auth/phone.js';
import { BILLABLE_STATUSES } from '../finance/finance.service.js';
import {
  Decimal,
  effectiveStatus,
  formatMoney,
  isoDate,
  receiptNumber,
} from '../finance/finance.util.js';

/**
 * Resident-facing response shapes. Every field below is chosen explicitly; no database row or owner-side response is ever
 * serialized directly. Anything not listed here (organization and resident ids, notes, adjustment and void records, correction
 * links, reversal reasons and actors, document fields, internal statuses, audit data) can never reach a resident.
 */

/** Invoices a resident can see: exactly the owner side's billable set (issued, part-paid, overdue, paid). Drafts and cancelled/void invoices are hidden. */
export const RESIDENT_VISIBLE_INVOICE_STATUSES = BILLABLE_STATUSES;

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

export function notFound(): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND' });
}

export function parseResidentPagination(query: unknown): { page: number; limit: number } {
  const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
  const read = (name: string, fallback: number, max: number) => {
    const raw = q[name];
    if (raw === undefined || raw === '') return fallback;
    const n = typeof raw === 'string' && /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new BadRequestException({ code: 'INVALID_PAGINATION', field: name });
    }
    return n;
  };
  return { page: read('page', 1, 100_000), limit: read('limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE) };
}

export interface Page<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export function toPage<T>(items: T[], total: number, page: number, limit: number): Page<T> {
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/** Last four characters only: enough to recognise a payment, not enough to use or trace it. */
export function maskReference(reference: string | null | undefined): string | null {
  const text = (reference ?? '').trim();
  if (!text) return null;
  return text.length <= 4 ? '****' : `****${text.slice(-4)}`;
}

// ------------------------------------------------------------------ profile
export interface ProfileDto {
  displayName: string;
  firstName: string;
  lastName: string;
  phone: string;
  accountStatus: string;
  residentStatus: string;
  organizationName: string;
  memberSince: string;
}

export function toProfileDto(row: {
  phoneE164: string;
  status: string;
  createdAt: Date;
  resident: { firstName: string; lastName: string; status: string };
  organization: { name: string };
}): ProfileDto {
  return {
    displayName: `${row.resident.firstName} ${row.resident.lastName}`.trim(),
    firstName: row.resident.firstName,
    lastName: row.resident.lastName,
    phone: maskPhone(row.phoneE164),
    accountStatus: row.status,
    residentStatus: row.resident.status,
    organizationName: row.organization.name,
    memberSince: row.createdAt.toISOString(),
  };
}

// ------------------------------------------------------------------ stay
export type StayStatus = 'CURRENT' | 'UPCOMING' | 'COMPLETED' | 'NONE' | 'UNDER_REVIEW';

export interface StayDto {
  status: StayStatus;
  current: {
    hostelName: string;
    organizationName: string;
    roomNumber: string;
    bedNumber: string;
    checkInDate: string;
    expectedCheckOutDate: string;
    monthlyRent: string;
    stayStatus: 'ACTIVE';
  } | null;
  upcoming: Array<{
    hostelName: string;
    roomNumber: string;
    bedNumber: string;
    startDate: string;
    endDate: string;
    monthlyRent: string;
    stage: 'BOOKED' | 'ADMISSION_PENDING' | 'ADMITTED_AWAITING_CHECK_IN' | 'START_DATE_PASSED';
  }>;
  lastStay: { checkedOutAt: string } | null;
}

/** The slice of StaySummaryService.getStaySummary that is read here; the allocation logic itself stays in that service. */
export interface StaySummaryInput {
  currentStay: {
    booking: {
      bedLabel: string;
      roomLabel: string;
      propertyName: string;
      endDate: string;
      monthlyPrice: string;
    };
    activeCheckIn: { checkInAt: string };
  } | null;
  currentStayStatus: string;
  upcomingBookings: Array<{
    booking: {
      bedLabel: string;
      roomLabel: string;
      propertyName: string;
      startDate: string;
      endDate: string;
      monthlyPrice: string;
    };
    classification: string;
  }>;
  lastCheckOut: { checkOutAt: string } | null;
}

const UPCOMING_STAGES: Record<string, StayDto['upcoming'][number]['stage']> = {
  FUTURE_NO_ADMISSION: 'BOOKED',
  ADMISSION_PENDING: 'ADMISSION_PENDING',
  ADMITTED_AWAITING_CHECKIN: 'ADMITTED_AWAITING_CHECK_IN',
  START_DATE_PASSED_NO_CHECKIN: 'START_DATE_PASSED',
};

export function emptyStay(status: StayStatus): StayDto {
  return { status, current: null, upcoming: [], lastStay: null };
}

export function toStayDto(summary: StaySummaryInput, organizationName: string): StayDto {
  if (summary.currentStayStatus === 'INCONSISTENT_ACTIVE_CHECK_INS')
    return emptyStay('UNDER_REVIEW');
  const upcoming = summary.upcomingBookings
    .filter((entry) => entry.classification in UPCOMING_STAGES)
    .map((entry) => ({
      hostelName: entry.booking.propertyName,
      roomNumber: entry.booking.roomLabel,
      bedNumber: entry.booking.bedLabel,
      startDate: entry.booking.startDate,
      endDate: entry.booking.endDate,
      monthlyRent: formatMoney(new Decimal(entry.booking.monthlyPrice)),
      stage: UPCOMING_STAGES[entry.classification]!,
    }));
  if (summary.currentStayStatus === 'ACTIVE' && summary.currentStay) {
    const { booking, activeCheckIn } = summary.currentStay;
    return {
      status: 'CURRENT',
      current: {
        hostelName: booking.propertyName,
        organizationName,
        roomNumber: booking.roomLabel,
        bedNumber: booking.bedLabel,
        checkInDate: activeCheckIn.checkInAt,
        expectedCheckOutDate: booking.endDate,
        monthlyRent: formatMoney(new Decimal(booking.monthlyPrice)),
        stayStatus: 'ACTIVE',
      },
      upcoming,
      lastStay: null,
    };
  }
  const lastStay = summary.lastCheckOut ? { checkedOutAt: summary.lastCheckOut.checkOutAt } : null;
  const status: StayStatus = upcoming.length ? 'UPCOMING' : lastStay ? 'COMPLETED' : 'NONE';
  return { status, current: null, upcoming, lastStay };
}

// ------------------------------------------------------------------ invoices, payments, receipts
export type PaymentStatus = 'COMPLETED' | 'REVERSED';

export interface PaymentDto {
  id: string;
  receiptNumber: string;
  paidAt: string;
  amount: string;
  method: string;
  reference: string | null;
  status: PaymentStatus;
  invoice: { id: string; number: string };
}

export interface InvoiceDto {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string | null;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  status: string;
}

export interface InvoiceDetailDto extends InvoiceDto {
  payments: Array<Omit<PaymentDto, 'invoice'>>;
}

export interface InvoiceRow {
  id: string;
  number: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date | null;
  dueDate: Date;
  amount: Prisma_Decimal;
  paidAmount: Prisma_Decimal;
  status: string;
}
type Prisma_Decimal = InstanceType<typeof Decimal>;

export const INVOICE_SELECT = {
  id: true,
  number: true,
  periodStart: true,
  periodEnd: true,
  issuedAt: true,
  dueDate: true,
  amount: true,
  paidAmount: true,
  status: true,
} as const;

export function toInvoiceDto(row: InvoiceRow, today: Date): InvoiceDto {
  return {
    id: row.id,
    number: row.number,
    periodStart: isoDate(row.periodStart),
    periodEnd: isoDate(row.periodEnd),
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    dueDate: isoDate(row.dueDate),
    totalAmount: formatMoney(row.amount),
    paidAmount: formatMoney(row.paidAmount),
    // Same definition as the owner views: the invoice amount less what has been settled against it.
    outstandingAmount: formatMoney(row.amount.minus(row.paidAmount)),
    status: effectiveStatus(row.status, row.dueDate, today),
  };
}

export interface PaymentRow {
  id: string;
  amount: Prisma_Decimal;
  method: string;
  reference: string | null;
  receivedAt: Date;
  reversals: Array<{ id: string }>;
}

export const PAYMENT_SELECT = {
  id: true,
  amount: true,
  method: true,
  reference: true,
  receivedAt: true,
  reversals: { select: { id: true } },
} as const;

export function toPaymentCore(row: PaymentRow): Omit<PaymentDto, 'invoice'> {
  return {
    id: row.id,
    receiptNumber: receiptNumber(row.id),
    paidAt: row.receivedAt.toISOString(),
    amount: formatMoney(row.amount),
    method: row.method,
    reference: maskReference(row.reference),
    status: row.reversals.length > 0 ? 'REVERSED' : 'COMPLETED',
  };
}

export function toPaymentDto(
  row: PaymentRow & { invoice: { id: string; number: string } },
): PaymentDto {
  return { ...toPaymentCore(row), invoice: { id: row.invoice.id, number: row.invoice.number } };
}

export function toInvoiceDetailDto(
  row: InvoiceRow & { payments: PaymentRow[] },
  today: Date,
): InvoiceDetailDto {
  return { ...toInvoiceDto(row, today), payments: row.payments.map(toPaymentCore) };
}

// ------------------------------------------------------------------ rent summary
export type RentStatus = 'NO_INVOICES' | 'PAID_UP' | 'DUE' | 'OVERDUE';

export interface RentSummaryDto {
  totalInvoiced: string;
  totalPaid: string;
  outstanding: string;
  overdue: string;
  nextDueDate: string | null;
  status: RentStatus;
  invoiceCount: number;
}

/** The status label is a presentation of the authoritative figures; it introduces no financial rule. */
export function toRentSummaryDto(input: {
  invoiced: Prisma_Decimal;
  paid: Prisma_Decimal;
  invoiceCount: number;
  outstanding: string;
  overdue: string;
  nextDueDate: Date | null;
}): RentSummaryDto {
  const owes = new Decimal(input.outstanding).gt(0);
  const late = new Decimal(input.overdue).gt(0);
  const status: RentStatus =
    input.invoiceCount === 0 ? 'NO_INVOICES' : late ? 'OVERDUE' : owes ? 'DUE' : 'PAID_UP';
  return {
    totalInvoiced: formatMoney(input.invoiced),
    totalPaid: formatMoney(input.paid),
    outstanding: input.outstanding,
    overdue: input.overdue,
    nextDueDate: input.nextDueDate ? isoDate(input.nextDueDate) : null,
    status,
    invoiceCount: input.invoiceCount,
  };
}

// ------------------------------------------------------------------ receipt
export interface ReceiptDto {
  receiptNumber: string;
  issuedBy: string;
  issuedTo: string;
  invoice: {
    number: string;
    periodStart: string;
    periodEnd: string;
    totalAmount: string;
    paidAmount: string;
    outstandingAmount: string;
    status: string;
  };
  payment: {
    id: string;
    paidAt: string;
    amount: string;
    method: string;
    reference: string | null;
    status: PaymentStatus;
  };
  balanceAfterPayment: string;
}

/** The slice of FinanceService.receipt that is read here; notes, credit snapshots, balance source and ids stay behind. */
export interface FinanceReceiptInput {
  organizationName: string;
  invoice: {
    number: string;
    periodStart: string;
    periodEnd: string;
    amount: string;
    paidAmount: string;
    balance: string;
    status: string;
  };
  receipts: Array<{
    reversed: boolean;
    receiptNumber: string;
    paymentId: string;
    amount: string;
    method: string;
    reference: string | null;
    receivedAt: string;
    balanceAfterPayment: string;
  }>;
}

export function toReceiptDto(input: FinanceReceiptInput, issuedTo: string): ReceiptDto {
  const receipt = input.receipts[0];
  if (!receipt) throw notFound();
  return {
    receiptNumber: receipt.receiptNumber,
    issuedBy: input.organizationName,
    issuedTo,
    invoice: {
      number: input.invoice.number,
      periodStart: input.invoice.periodStart,
      periodEnd: input.invoice.periodEnd,
      totalAmount: input.invoice.amount,
      paidAmount: input.invoice.paidAmount,
      outstandingAmount: input.invoice.balance,
      status: input.invoice.status,
    },
    payment: {
      id: receipt.paymentId,
      paidAt: receipt.receivedAt,
      amount: receipt.amount,
      method: receipt.method,
      reference: maskReference(receipt.reference),
      status: receipt.reversed ? 'REVERSED' : 'COMPLETED',
    },
    balanceAfterPayment: receipt.balanceAfterPayment,
  };
}
