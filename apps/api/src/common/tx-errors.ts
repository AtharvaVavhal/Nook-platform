/**
 * Classification of database / Prisma transaction failures for the correction path (specification v1.3 section 11.4).
 *
 * Rules:
 *  - Only an exact SQLSTATE read from the driver error decides a retry. Message text is never used.
 *  - 40P01 (deadlock) and 40001 (serialization failure) are the only automatically retried states.
 *  - 55P03 (lock timeout) is not mapped by the installed Prisma adapter; it arrives as a generic driver error carrying
 *    `originalCode`, so the SQLSTATE is read from the error itself.
 *  - A Prisma transaction API error (P2028), a lost connection, or any other ambiguous failure is an UNCERTAIN outcome.
 *    The implementation does not claim to know whether COMMIT was reached; the client resolves it by re-sending the same
 *    Idempotency-Key, which hits the command receipt.
 *
 * The exact shapes Prisma produces for each condition have not been observed against a real server; the unit tests cover
 * the shapes this classifier reads, and the disposable-database acceptance run (A10) must record the real ones.
 */

export type FailureClass =
  | 'DEADLOCK' // SQLSTATE 40P01
  | 'SERIALIZATION' // SQLSTATE 40001
  | 'LOCK_TIMEOUT' // SQLSTATE 55P03
  | 'UNIQUE_VIOLATION' // SQLSTATE 23505
  | 'FOREIGN_KEY_VIOLATION' // SQLSTATE 23503
  | 'UNCERTAIN' // Prisma P2028, connection loss, statement cancel, unknown
  | 'OTHER';

const SQLSTATE = /^[0-9A-Z]{5}$/;

type ErrorLike = {
  code?: unknown;
  cause?: { code?: unknown; originalCode?: unknown };
  meta?: {
    driverAdapterError?: {
      originalCode?: unknown;
      cause?: { originalCode?: unknown; code?: unknown };
    };
    code?: unknown;
  };
};

/** Every SQLSTATE-looking value the error carries. Prisma's own `Pxxxx` codes are not SQLSTATEs. */
export function sqlStates(error: unknown): string[] {
  const e = (error ?? {}) as ErrorLike;
  const candidates = [
    e.code,
    e.cause?.code,
    e.cause?.originalCode,
    e.meta?.code,
    e.meta?.driverAdapterError?.originalCode,
    e.meta?.driverAdapterError?.cause?.originalCode,
    e.meta?.driverAdapterError?.cause?.code,
  ];
  return candidates.filter(
    (value): value is string =>
      typeof value === 'string' && SQLSTATE.test(value) && !/^P\d{4}$/.test(value),
  );
}

function prismaCode(error: unknown): string | undefined {
  const code = (error as ErrorLike | undefined)?.code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : undefined;
}

export function classifyFailure(error: unknown): FailureClass {
  const states = sqlStates(error);
  if (states.includes('40P01')) return 'DEADLOCK';
  if (states.includes('40001')) return 'SERIALIZATION';
  if (states.includes('55P03')) return 'LOCK_TIMEOUT';
  if (states.includes('23505')) return 'UNIQUE_VIOLATION';
  if (states.includes('23503')) return 'FOREIGN_KEY_VIOLATION';
  const prisma = prismaCode(error);
  if (prisma === 'P2028') return 'UNCERTAIN';
  if (
    states.some((state) => state === '57014' || state === '57P01' || state.startsWith('08')) ||
    ['P1001', 'P1002', 'P1008', 'P1017'].includes(prisma ?? '')
  ) {
    return 'UNCERTAIN';
  }
  const message = (error as { message?: unknown } | undefined)?.message;
  // Socket-level driver errors carry a Node error code (ECONNRESET ...), never a SQLSTATE.
  const nodeCode = (error as { code?: unknown } | undefined)?.code;
  if (
    typeof nodeCode === 'string' &&
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(nodeCode) &&
    typeof message === 'string'
  ) {
    return 'UNCERTAIN';
  }
  return 'OTHER';
}

/** At most two automatic whole-transaction retries, only for these two states. */
export function isAutoRetryable(failure: FailureClass): boolean {
  return failure === 'DEADLOCK' || failure === 'SERIALIZATION';
}

/** Name of the violated constraint or index when the driver supplied one (never exposed to clients). */
export function violatedConstraint(error: unknown): string | undefined {
  const e = error as {
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } };
    };
  };
  const adapter = e?.meta?.driverAdapterError?.cause?.constraint;
  if (typeof adapter?.index === 'string') return adapter.index;
  if (typeof e?.meta?.target === 'string') return e.meta.target;
  if (Array.isArray(adapter?.fields)) return adapter.fields.join(',');
  return undefined;
}
