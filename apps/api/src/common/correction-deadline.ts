import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/client.js';

/** Preserve the 30s attempt ceiling while reserving time for driver rollback/connection release. */
export const CORRECTION_CLEANUP_RESERVE_MS = 1_000;

export function correctionDeadlineClient(
  tx: Prisma.TransactionClient,
  timeoutMs: number,
): Prisma.TransactionClient {
  const deadline = Date.now() + timeoutMs - CORRECTION_CLEANUP_RESERVE_MS;
  let queue: Promise<unknown> = Promise.resolve();
  let requestedLockTimeout = 5000;
  const operation = (fn: () => unknown) => {
    const result = queue.then(async () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new ConflictException({
          code: 'RETRY_REQUIRED',
          message: 'The transaction deadline was reached; retry with the same Idempotency-Key.',
        });
      // Server cancellation interrupts active SQL; Prisma's client timer alone queues rollback behind active SQL.
      // Each operation is serialized just as pg serializes one connection, so queued work gets a fresh budget.
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${`${remaining}ms`}, true)`;
      await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${Math.min(requestedLockTimeout, 5000, remaining)}ms`}, true)`;
      return fn();
    });
    queue = result;
    return result;
  };
  const delegates = new Map<PropertyKey, unknown>();
  return new Proxy(tx, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value === 'function')
        return (...args: unknown[]) =>
          operation(() => {
            const sql = Array.isArray(args[0]) ? args[0].join('?') : '';
            if (key === '$executeRaw' && sql.includes("set_config('lock_timeout'")) {
              const configured = Number.parseInt(String(args[1]), 10);
              if (Number.isFinite(configured) && configured > 0)
                requestedLockTimeout = Math.min(5000, configured);
            }
            return value.apply(target, args);
          });
      if (!value || typeof value !== 'object') return value;
      if (!delegates.has(key))
        delegates.set(
          key,
          new Proxy(value, {
            get(delegate, method) {
              const call = Reflect.get(delegate, method);
              return typeof call === 'function'
                ? (...args: unknown[]) => operation(() => call.apply(delegate, args))
                : call;
            },
          }),
        );
      return delegates.get(key);
    },
  });
}
