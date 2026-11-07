import { parseBillingMonth, shiftMonth, todayIst } from '../finance/finance.util.js';

/**
 * The billing months a scheduler run covers, oldest first: the previous `lookbackMonths` months and the current one, all
 * in Asia/Kolkata. A run at 06:00 IST on the 1st therefore bills the month that just began and sweeps up the one that just
 * ended, and a run that was missed is repaired by the next one (idempotency makes the repeat harmless).
 */
export function schedulerMonths(now: Date, lookbackMonths: number): string[] {
  if (!Number.isInteger(lookbackMonths) || lookbackMonths < 0 || lookbackMonths > 12) {
    throw new RangeError('lookbackMonths must be a whole number between 0 and 12');
  }
  const today = todayIst(now);
  const current = parseBillingMonth(today.toISOString().slice(0, 7));
  const months: string[] = [];
  for (let back = lookbackMonths; back >= 0; back -= 1) {
    months.push(shiftMonth(current, -back).month);
  }
  return months;
}

/** Failures worth another attempt: a deadlock, a lost connection, a serialization failure or a pool timeout. */
export function isTransientError(error: unknown): boolean {
  const e = error as {
    code?: unknown;
    message?: unknown;
    cause?: { code?: unknown; originalCode?: unknown };
    meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } };
  };
  const codes = [
    e?.code,
    e?.cause?.code,
    e?.cause?.originalCode,
    e?.meta?.driverAdapterError?.cause?.originalCode,
  ].filter((value): value is string => typeof value === 'string');
  const transientCodes = new Set([
    'P2034', // Prisma: write conflict or deadlock
    'P2024', // Prisma: timed out fetching a connection from the pool
    'P1001', // cannot reach the database server
    'P1002', // the database server timed out
    'P1008', // operations timed out
    'P1017', // the server closed the connection
    '40001', // serialization failure
    '40P01', // deadlock detected
    '57P01', // admin shutdown (restart or failover)
    '08000',
    '08001',
    '08003',
    '08006',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
  ]);
  if (codes.some((code) => transientCodes.has(code))) return true;
  return /deadlock detected|could not serialize|connection (terminated|reset|refused)|timeout expired/i.test(
    String(e?.message ?? ''),
  );
}
