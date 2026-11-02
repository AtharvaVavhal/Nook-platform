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

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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

/** Client-side amount check mirroring the server rule: positive, at most 2 decimals. */
export function isValidAmountInput(value: string): boolean {
  return /^\d{1,10}(\.\d{1,2})?$/.test(value.trim()) && !/^0+(\.0+)?$/.test(value.trim());
}

/** Exact minor units (paise) from a validated 2-decimal string, so comparisons never touch floats. */
export function toMinorUnits(value: string): bigint {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}
