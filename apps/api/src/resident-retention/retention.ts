import { RESIDENT_THROTTLE } from '../resident-auth/policy.js';

/**
 * Retention cleanup for the three resident sign-in tables (owner decision OD-04, 2026-11-22):
 *   - OTP challenges: deleted 7 days after they expire.
 *   - Sessions: deleted 30 days after they expired or were revoked, whichever came first.
 *   - Throttle rows: deleted 1 day after their counting window and lock have both ended.
 * `audit_events` is deliberately absent: its retention period is undecided and nothing here may delete from it.
 *
 * The code is database-driver independent (it needs only `query`), so it is unit-tested with a fake executor. It must run as a
 * separate, least-privilege cleanup role (SELECT and DELETE on exactly these three tables); the runtime role has no DELETE.
 */
export const RETENTION_POLICY = { otpChallengeDays: 7, sessionDays: 30, throttleDays: 1 } as const;

export const DEFAULT_BATCH_SIZE = 500;
export const MAX_BATCH_SIZE = 5000;
export const DEFAULT_MAX_BATCHES = 100;
export const MAX_MAX_BATCHES = 1000;
/** Session-level advisory lock key: one cleanup at a time per database. */
export const RETENTION_LOCK_KEY = '8326191900001';

const DAY_MS = 86_400_000;

export interface QueryResult {
  readonly rowCount: number | null;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}
export interface RetentionExecutor {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
}

export type RetentionTargetName = 'otp_challenges' | 'sessions' | 'throttles';

interface RetentionTarget {
  readonly name: RetentionTargetName;
  readonly table: string;
  readonly keyColumns: string;
  readonly days: number;
  /** A boolean expression over the table's own columns; `$1` is the cutoff timestamp. Selects only rows past retention. */
  readonly predicate: string;
}

/** The window length, in seconds, of every throttle scope that counts events; scopes without a rule are timed locks only. */
function throttleWindowCase(): string {
  const arms = Object.entries(RESIDENT_THROTTLE).map(([scope, rule]) => {
    if (
      !/^[A-Z_]+$/.test(scope) ||
      !Number.isInteger(rule.windowSeconds) ||
      rule.windowSeconds < 0
    ) {
      throw new Error('invalid throttle rule');
    }
    return `WHEN '${scope}' THEN ${rule.windowSeconds}`;
  });
  return `CASE scope ${arms.join(' ')} ELSE 0 END`;
}

export const RETENTION_TARGETS: readonly RetentionTarget[] = [
  {
    name: 'otp_challenges',
    table: 'resident_otp_challenges',
    keyColumns: 'id',
    days: RETENTION_POLICY.otpChallengeDays,
    predicate: 'expires_at < $1',
  },
  {
    name: 'sessions',
    table: 'resident_sessions',
    keyColumns: 'id',
    days: RETENTION_POLICY.sessionDays,
    // The moment the session stopped being usable: its revocation, or its earlier expiry. A live session has all three later than now.
    predicate:
      "LEAST(COALESCE(revoked_at, 'infinity'::timestamptz), idle_expires_at, absolute_expires_at) < $1",
  },
  {
    name: 'throttles',
    table: 'resident_auth_throttles',
    keyColumns: 'scope, key_hash',
    days: RETENTION_POLICY.throttleDays,
    // Both the counting window and any lock must have ended before the cutoff.
    predicate: `GREATEST(window_started_at + (${throttleWindowCase()}) * interval '1 second', COALESCE(locked_until, window_started_at)) < $1`,
  },
];

export interface RetentionOptions {
  readonly now?: Date;
  readonly batchSize?: number;
  readonly maxBatchesPerTarget?: number;
  /** Count only; nothing is deleted. Callers must opt in to deletion explicitly. */
  readonly dryRun: boolean;
}

export interface RetentionTargetReport {
  readonly name: RetentionTargetName;
  readonly cutoff: string;
  readonly deleted: number;
  readonly wouldDelete?: number;
  readonly batches: number;
  /** True when the batch limit was reached while rows past retention may remain; the next run continues. */
  readonly moreRemain: boolean;
  /** A SQLSTATE or a short code. Never a message, a value or a connection detail. */
  readonly error?: string;
}

export interface RetentionReport {
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly skipped?: 'LOCK_HELD';
  readonly targets: readonly RetentionTargetReport[];
}

export function cutoffFor(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

function intInRange(
  value: number | undefined,
  fallback: number,
  max: number,
  label: string,
): number {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v < 1 || v > max)
    throw new Error(`${label} must be an integer from 1 to ${max}`);
  return v;
}

const errorCode = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'UNKNOWN';
};

export function deleteBatchSql(target: RetentionTarget): string {
  return `DELETE FROM ${target.table} WHERE (${target.keyColumns}) IN (SELECT ${target.keyColumns} FROM ${target.table} WHERE ${target.predicate} LIMIT $2)`;
}
export function countSql(target: RetentionTarget): string {
  return `SELECT count(*)::int AS n FROM ${target.table} WHERE ${target.predicate}`;
}

/**
 * One cleanup pass. Idempotent: a second run immediately after finds nothing. Bounded: at most `maxBatchesPerTarget` batches of
 * `batchSize` rows per table. Exclusive: a session advisory lock keeps two runs from overlapping; the executor must be one
 * dedicated connection so the lock lives as long as the run.
 */
export async function runRetention(
  executor: RetentionExecutor,
  options: RetentionOptions,
): Promise<RetentionReport> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('now must be a valid date');
  const batchSize = intInRange(options.batchSize, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE, 'batchSize');
  const maxBatches = intInRange(
    options.maxBatchesPerTarget,
    DEFAULT_MAX_BATCHES,
    MAX_MAX_BATCHES,
    'maxBatchesPerTarget',
  );

  const lock = await executor.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [
    RETENTION_LOCK_KEY,
  ]);
  if (lock.rows[0]?.locked !== true) {
    return { ok: true, dryRun: options.dryRun, skipped: 'LOCK_HELD', targets: [] };
  }

  const targets: RetentionTargetReport[] = [];
  let ok = true;
  try {
    for (const target of RETENTION_TARGETS) {
      const cutoff = cutoffFor(now, target.days);
      const base = { name: target.name, cutoff: cutoff.toISOString() };
      try {
        if (options.dryRun) {
          const counted = await executor.query(countSql(target), [cutoff]);
          targets.push({
            ...base,
            deleted: 0,
            wouldDelete: Number(counted.rows[0]?.n ?? 0),
            batches: 0,
            moreRemain: false,
          });
          continue;
        }
        let deleted = 0;
        let batches = 0;
        let moreRemain = false;
        while (batches < maxBatches) {
          const result = await executor.query(deleteBatchSql(target), [cutoff, batchSize]);
          const n = result.rowCount ?? 0;
          batches += 1;
          deleted += n;
          if (n < batchSize) break;
          if (batches === maxBatches) moreRemain = true;
        }
        targets.push({ ...base, deleted, batches, moreRemain });
      } catch (error) {
        ok = false;
        targets.push({
          ...base,
          deleted: 0,
          batches: 0,
          moreRemain: false,
          error: errorCode(error),
        });
      }
    }
  } finally {
    try {
      await executor.query('SELECT pg_advisory_unlock($1::bigint)', [RETENTION_LOCK_KEY]);
    } catch {
      // The lock is session-level: closing the connection releases it.
    }
  }
  return { ok, dryRun: options.dryRun, targets };
}
