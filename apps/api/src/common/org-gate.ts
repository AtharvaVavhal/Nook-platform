import type { Prisma } from '../generated/client.js';

/**
 * The scoped exclusive organization gate (specification v1.3 section 10).
 *
 * Every transaction that writes a booking, admission, check-in or check-out, that creates/issues invoices or runs monthly
 * generation, or that submits/applies a lifecycle correction, calls `acquireOrgGate` ONCE, first among its resource
 * locks. The gate is a transaction-scoped advisory lock taken directly in exclusive mode and never upgraded; it is
 * released by PostgreSQL when the transaction ends.
 *
 * Lock order (v1.3 10.2): command-key lock -> proposal row -> THIS GATE -> invoice-number lock -> source rows
 * (Bed, Resident, Booking, Admission, CheckIn, CheckOut) -> Invoice. A correction that holds the gate must never take a
 * Resident row lock and then an Invoice lock.
 *
 * What is proven and what is not: this is source-level design. That `lock_timeout` bounds the wait for an advisory lock,
 * the queueing behaviour of waiters and the absence of deadlocks are PostgreSQL behaviours that have to be shown on an
 * authorized disposable database (acceptance criteria A1-A10); nothing here claims they have been.
 */

type RawTx = Pick<Prisma.TransactionClient, '$executeRaw'>;

/** Key text for the organization gate. One derivation, used by every module. */
export function orgGateKeyText(organizationId: string): string {
  return `nook:lifecycle-gate:${organizationId}`;
}

/** Transaction-local `lock_timeout` in milliseconds (set_config(..., true) is scoped to the current transaction). */
export async function setLocalLockTimeout(tx: RawTx, milliseconds: number): Promise<void> {
  const ms = Math.max(1, Math.floor(milliseconds));
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${ms}ms`}, true)`;
}

export interface GateOptions {
  /** Per-acquisition lock wait. Ordinary writers 3 s, corrections 5 s (bounded by the remaining budget). */
  lockTimeoutMs?: number;
}

/** Ordinary gate acquirers (booking, admission, check-in/out, Finance generation): a held gate returns a clean 409. */
export const ORDINARY_GATE_LOCK_TIMEOUT_MS = 3_000;
/**
 * Explicit Prisma interactive-transaction options for gate acquirers. `maxWait` is the time to obtain a connection, not
 * a lock wait; `timeout` is the whole transaction. They are separate from PostgreSQL `lock_timeout`.
 */
export const ORDINARY_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
export const CORRECTION_GATE_LOCK_TIMEOUT_MS = 5_000;
export const CORRECTION_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export async function acquireOrgGate(
  tx: RawTx,
  organizationId: string,
  options: GateOptions = {},
): Promise<void> {
  await setLocalLockTimeout(tx, options.lockTimeoutMs ?? ORDINARY_GATE_LOCK_TIMEOUT_MS);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${orgGateKeyText(organizationId)}, 0))`;
}
