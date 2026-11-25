import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { keyedHash, requireOtpSecret } from './otp.js';
import { RESIDENT_THROTTLE, type ResidentThrottleScope } from './policy.js';

export interface ThrottleTarget {
  readonly scope: ResidentThrottleScope;
  readonly value: string;
}

/**
 * Persistent rate limiting for resident sign-in, in `resident_auth_throttles` (separate from the owner table). State survives
 * restarts and is shared by every API instance; counting is one atomic upsert per key. Keys are keyed hashes.
 */
@Injectable()
export class ResidentThrottleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private hash(target: ThrottleTarget): string {
    return keyedHash(requireOtpSecret(), target.scope, target.value);
  }

  /** The latest lock expiry among the keys, or null when none is locked. */
  async lockedUntil(targets: readonly ThrottleTarget[]): Promise<Date | null> {
    const rows = await this.prisma.db.residentAuthThrottle.findMany({
      where: {
        OR: targets.map((t) => ({ scope: t.scope, keyHash: this.hash(t) })),
        lockedUntil: { gt: new Date() },
      },
      select: { lockedUntil: true },
    });
    const times = rows.map((r) => r.lockedUntil!.getTime());
    return times.length ? new Date(Math.max(...times)) : null;
  }

  /** Counts one event; once the window's limit is reached the key is locked for the rule's lock time. */
  async hit(
    target: ThrottleTarget & { scope: Exclude<ResidentThrottleScope, 'OTP_COOLDOWN_PHONE'> },
  ): Promise<void> {
    const rule = RESIDENT_THROTTLE[target.scope];
    const hash = this.hash(target);
    await this.prisma.db.$executeRaw`
      INSERT INTO resident_auth_throttles (scope, key_hash, failures, window_started_at, locked_until, updated_at)
      VALUES (${target.scope}, ${hash}, 1, now(), NULL, now())
      ON CONFLICT (scope, key_hash) DO UPDATE SET
        failures = CASE WHEN resident_auth_throttles.window_started_at < now() - (${rule.windowSeconds}::int * interval '1 second')
                        THEN 1 ELSE resident_auth_throttles.failures + 1 END,
        window_started_at = CASE WHEN resident_auth_throttles.window_started_at < now() - (${rule.windowSeconds}::int * interval '1 second')
                                 THEN now() ELSE resident_auth_throttles.window_started_at END,
        locked_until = CASE WHEN (CASE WHEN resident_auth_throttles.window_started_at < now() - (${rule.windowSeconds}::int * interval '1 second')
                                       THEN 1 ELSE resident_auth_throttles.failures + 1 END) >= ${rule.limit}
                            THEN now() + (${rule.lockSeconds}::int * interval '1 second')
                            ELSE resident_auth_throttles.locked_until END,
        updated_at = now()`;
  }

  /**
   * Takes a timed lock only if it is free, in one atomic statement (the resend cooldown). Returns false when someone else holds
   * it, so two concurrent code requests for one phone cannot both pass.
   */
  async tryLock(target: ThrottleTarget, seconds: number): Promise<boolean> {
    const hash = this.hash(target);
    const rows = await this.prisma.db.$queryRaw<Array<{ ok: number }>>`
      INSERT INTO resident_auth_throttles (scope, key_hash, failures, window_started_at, locked_until, updated_at)
      VALUES (${target.scope}, ${hash}, 0, now(), now() + (${seconds}::int * interval '1 second'), now())
      ON CONFLICT (scope, key_hash) DO UPDATE SET
        locked_until = now() + (${seconds}::int * interval '1 second'),
        updated_at = now()
      WHERE resident_auth_throttles.locked_until IS NULL OR resident_auth_throttles.locked_until <= now()
      RETURNING 1 AS ok`;
    return rows.length === 1;
  }

  /** A successful sign-in clears that phone's failure counter (the address counter keeps running). */
  async reset(target: ThrottleTarget): Promise<void> {
    await this.prisma.db.residentAuthThrottle.updateMany({
      where: { scope: target.scope, keyHash: this.hash(target) },
      data: { failures: 0, lockedUntil: null, updatedAt: new Date() },
    });
  }
}
