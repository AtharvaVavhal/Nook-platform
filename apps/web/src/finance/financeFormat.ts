import type { InvoiceStatus, PaymentMethod } from './financeApi';

// Display-only formatting. Amounts arrive as exact decimal strings from the server.
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

export function formatMoney(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '—';
  return inr.format(Number(value));
}

/** Dates from the API are YYYY-MM-DD (no time zone); render them without shifting the day. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: value.length === 10 ? 'UTC' : undefined,
  });
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number);
  if (!year || !m) return month;
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const IST = 'Asia/Kolkata';
/** The Asia/Kolkata calendar date (YYYY-MM-DD) of an instant, whatever the browser's time zone is. */
export function istDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The current billing month (YYYY-MM) in Asia/Kolkata, the zone the server bills in. */
export function currentMonth(now: Date = new Date()): string {
  return istDate(now).slice(0, 7);
}

/**
 * The instant sent as `receivedAt` for a chosen received date. Today means "now"; an earlier date is
 * noon India time, sent with an explicit +05:30 offset so the server never has to guess the zone.
 */
export function receivedAtFor(receivedDate: string, now: Date = new Date()): string {
  return receivedDate === istDate(now)
    ? now.toISOString()
    : new Date(`${receivedDate}T12:00:00+05:30`).toISOString();
}

export const statusLabels: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PAID: 'Paid',
  PARTIALLY_PAID: 'Partially paid',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
};

export const methodLabels: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
};

/**
 * Whether the Void action is offered. The server and database make the final decision; this only hides an
 * action that would certainly be refused: voiding needs no cash held and no credits applied, and is terminal.
 */
export function canVoidInvoice(invoice: {
  storedStatus: string;
  cashReceived: string;
  adjustmentTotal: string;
}): boolean {
  return (
    invoice.storedStatus !== 'CANCELLED' &&
    toMinorUnits(invoice.cashReceived.replace('-', '')) === 0n &&
    toMinorUnits(invoice.adjustmentTotal.replace('-', '')) === 0n
  );
}

/** Why a not-yet-void invoice cannot be voided, in words, or null when it can. */
export function voidBlockedReason(invoice: {
  storedStatus: string;
  cashReceived: string;
  adjustmentTotal: string;
}): string | null {
  if (invoice.storedStatus === 'CANCELLED') return null;
  const reasons: string[] = [];
  if (toMinorUnits(invoice.adjustmentTotal.replace('-', '')) !== 0n) {
    reasons.push('credits are applied and cannot be reversed');
  }
  if (toMinorUnits(invoice.cashReceived.replace('-', '')) !== 0n) {
    reasons.push('payments are still held (reverse each one first)');
  }
  return reasons.length ? `This invoice cannot be voided: ${reasons.join('; ')}.` : null;
}

/** Client-side amount check mirroring the server rule: positive, at most 2 decimals. */
export function isValidAmountInput(value: string): boolean {
  return /^\d{1,10}(\.\d{1,2})?$/.test(value.trim()) && !/^0+(\.0+)?$/.test(value.trim());
}

/** Exact minor units (paise) from a validated 2-decimal string, so comparisons never touch floats. */
export function toMinorUnits(value: string): bigint {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}
