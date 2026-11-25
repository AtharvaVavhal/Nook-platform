/**
 * Display formatting. The API sends money as exact two-decimal strings ("8000.00") and dates as `YYYY-MM-DD` or ISO
 * timestamps. Nothing here does arithmetic on money; a value that cannot be read is shown as an em dash, never as a
 * made-up figure.
 */
export const DASH = '—';
const MONEY = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Indian digit grouping: 1,23,456.00 */
function groupIndian(whole: string): string {
  const digits = whole.replace(/^0+(?=\d)/, '');
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

export function formatInr(amount: string | null | undefined): string {
  if (typeof amount !== 'string') return DASH;
  const match = MONEY.exec(amount.trim());
  if (!match) return DASH;
  const sign = match[1] ?? '';
  const whole = match[2] ?? '0';
  const fraction = (match[3] ?? '').padEnd(2, '0');
  return `${sign}₹${groupIndian(whole)}.${fraction}`;
}

export function isZeroAmount(amount: string | null | undefined): boolean {
  return typeof amount === 'string' && /^-?0+(\.0+)?$/.test(amount.trim());
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const DATE_FORMAT_IST = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});
const DATE_TIME_IST = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});
const MONTH_YEAR = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function parseDateOnly(value: string): Date | null {
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "5 Nov 2026". A date-only value is shown as written (no time zone shift); a timestamp is shown in India time. */
export function formatDate(value: string | null | undefined): string {
  if (typeof value !== 'string' || value === '') return DASH;
  const dateOnly = parseDateOnly(value);
  if (dateOnly) return DATE_FORMAT.format(dateOnly);
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? DASH : DATE_FORMAT_IST.format(instant);
}

export function formatDateTime(value: string | null | undefined): string {
  if (typeof value !== 'string' || value === '') return DASH;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime())
    ? DASH
    : DATE_TIME_IST.format(instant).replace(/\b(am|pm)\b/, (s) => s.toUpperCase());
}

/** "November 2026" for a one-month period, otherwise "1 Nov 2026 – 30 Nov 2026". */
export function formatBillingPeriod(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const a = typeof start === 'string' ? parseDateOnly(start) : null;
  const b = typeof end === 'string' ? parseDateOnly(end) : null;
  if (!a || !b) return DASH;
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth())
    return MONTH_YEAR.format(a);
  return `${DATE_FORMAT.format(a)} – ${DATE_FORMAT.format(b)}`;
}

export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function initials(displayName: string | null | undefined): string {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'N';
  const first = Array.from(parts[0] ?? '')[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1] ?? '')[0] ?? '') : '';
  return (first + last).toUpperCase() || 'N';
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const METHODS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
};
export function methodLabel(method: string | null | undefined): string {
  if (!method) return DASH;
  return METHODS[method] ?? method.charAt(0) + method.slice(1).toLowerCase().replace(/_/g, ' ');
}
