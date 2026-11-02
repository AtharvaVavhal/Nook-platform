import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/client.js';

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER'] as const;
export type PaymentMethodName = (typeof PAYMENT_METHODS)[number];

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const CREDIT_PATTERN = /^-\d{1,10}(\.\d{1,2})?$/;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Parses a money value without ever passing through binary floating point arithmetic. */
export function parseMoney(value: unknown, field: string): Decimal {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`${field} must be a positive amount with at most 2 decimals`);
  }
  const text = String(value).trim();
  if (!MONEY_PATTERN.test(text)) {
    throw new BadRequestException(`${field} must be a positive amount with at most 2 decimals`);
  }
  const amount = new Decimal(text);
  if (!amount.gt(0)) {
    throw new BadRequestException(`${field} must be greater than zero`);
  }
  return amount;
}

/**
 * Parses a signed invoice adjustment. Only credits (negative amounts) are supported: an extra
 * charge belongs on a new invoice, so a positive value is rejected rather than reinterpreted.
 */
export function parseCredit(value: unknown, field: string): Decimal {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (/^\+?\d/.test(text) && MONEY_PATTERN.test(text.replace(/^\+/, ''))) {
    throw new BadRequestException(
      `${field} must be a negative amount (credits only); use a new invoice for extra charges`,
    );
  }
  if (!CREDIT_PATTERN.test(text)) {
    throw new BadRequestException(`${field} must be a negative amount with at most 2 decimals`);
  }
  const amount = new Decimal(text);
  if (!amount.lt(0)) throw new BadRequestException(`${field} must be less than zero`);
  return amount;
}

/** A correction reason is mandatory, so every reversal and credit explains itself. */
export function parseReason(value: unknown, field = 'reason'): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 3 || text.length > 500) {
    throw new BadRequestException(`${field} is required (3 to 500 characters)`);
  }
  return text;
}

export function toDecimal(value: unknown): Decimal {
  return new Decimal(String(value));
}

export function formatMoney(value: Decimal): string {
  return value.toFixed(2);
}

export function parseDateOnly(value: unknown, field: string): Date {
  const text = typeof value === 'string' ? value : '';
  const match = DATE_PATTERN.exec(text);
  if (!match) throw new BadRequestException(`${field} must be a date in YYYY-MM-DD format`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== text) {
    throw new BadRequestException(`${field} is not a valid calendar date`);
  }
  return date;
}

export interface BillingPeriod {
  readonly month: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly nextPeriodStart: Date;
}

/** A billing period is one calendar month; periodEnd is the last day of the month. */
export function parseBillingMonth(value: unknown, field = 'month'): BillingPeriod {
  const match = typeof value === 'string' ? MONTH_PATTERN.exec(value) : null;
  if (!match) throw new BadRequestException(`${field} must be in YYYY-MM format`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (year < 2000 || year > 2100) throw new BadRequestException(`${field} is out of range`);
  const periodStart = new Date(Date.UTC(year, monthIndex, 1));
  const nextPeriodStart = new Date(Date.UTC(year, monthIndex + 1, 1));
  return {
    month: value as string,
    periodStart,
    periodEnd: new Date(nextPeriodStart.getTime() - MS_PER_DAY),
    nextPeriodStart,
  };
}

export function shiftMonth(period: BillingPeriod, offset: number): BillingPeriod {
  const shifted = new Date(
    Date.UTC(period.periodStart.getUTCFullYear(), period.periodStart.getUTCMonth() + offset, 1),
  );
  return parseBillingMonth(shifted.toISOString().slice(0, 7));
}

// Asia/Kolkata is a fixed +05:30 offset (India observes no daylight saving time).
const IST_OFFSET_MS = 330 * 60_000;

/** Today's calendar date in Asia/Kolkata, as a UTC-midnight date-only value. */
export function todayIst(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** Invoice numbers reset on 1 January in Asia/Kolkata, not UTC. */
export function billingYearIst(now: Date = new Date()): number {
  return todayIst(now).getUTCFullYear();
}

/** The instant a date-only value begins in Asia/Kolkata (used to compare against timestamps). */
export function istStartOfDay(dateOnly: Date): Date {
  return new Date(dateOnly.getTime() - IST_OFFSET_MS);
}

/** Default due date: the 5th of the billing month. */
export function defaultDueDate(periodStart: Date): Date {
  return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 5));
}

export function formatInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(4, '0')}`;
}

export function receiptNumber(paymentId: string): string {
  return `RCPT-${paymentId}`;
}

export type StoredInvoiceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'OVERDUE'
  | 'CANCELLED';

/** Status after a payment: PAID only when the remaining balance reaches exactly zero. */
export function statusAfterPayment(amount: Decimal, newPaid: Decimal): 'PAID' | 'PARTIALLY_PAID' {
  return newPaid.eq(amount) ? 'PAID' : 'PARTIALLY_PAID';
}

/**
 * Status after a reversal or credit. `settled` is paid_amount (cash net of reversals plus
 * credits) and `cash` is the cash actually held: PAID once settled, PARTIALLY_PAID while any
 * cash is held, otherwise ISSUED. A reversal can therefore move PAID back down.
 */
export function statusAfterCorrection(
  amount: Decimal,
  settled: Decimal,
  cash: Decimal,
): 'PAID' | 'PARTIALLY_PAID' | 'ISSUED' {
  if (settled.eq(amount)) return 'PAID';
  return cash.gt(0) ? 'PARTIALLY_PAID' : 'ISSUED';
}

const OPEN_STATUSES: readonly StoredInvoiceStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

export function isOpenStatus(status: string): boolean {
  return OPEN_STATUSES.includes(status as StoredInvoiceStatus);
}

/** Overdue is derived from the due date at read time; it is never an automatic action. */
export function effectiveStatus(status: string, dueDate: Date, today: Date): StoredInvoiceStatus {
  if (isOpenStatus(status) && dueDate.getTime() < today.getTime()) return 'OVERDUE';
  if (status === 'OVERDUE') return 'ISSUED';
  return status as StoredInvoiceStatus;
}

export function daysOverdue(dueDate: Date, today: Date): number {
  return Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / MS_PER_DAY));
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parsePage(value: unknown, fallback: number, max: number, field: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new BadRequestException(`${field} must be an integer between 1 and ${max}`);
  }
  return n;
}
