import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  THROTTLE_LIMITS,
  THROTTLE_LOCK_MINUTES,
  THROTTLE_WINDOW_MINUTES,
  throttleKeyHash,
  type ThrottleScope,
} from './auth-security.js';

export interface ThrottleKey {
  readonly scope: ThrottleScope;
  readonly value: string;
}

/**
 * Persistent sign-in throttling. State lives in `login_throttles`, so a restart or a second API
 * instance cannot reset it. Failures are counted atomically in one upsert per key.
 */
@Injectable()
export class LoginThrottleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The latest lock expiry among the given keys, or null when none is currently locked. */
  async lockedUntil(keys: readonly ThrottleKey[]): Promise<Date | null> {
    const hashes = keys.map((k) => ({
      scope: k.scope,
      keyHash: throttleKeyHash(k.scope, k.value),
    }));
    const rows = await this.prisma.db.loginThrottle.findMany({
      where: { OR: hashes, lockedUntil: { gt: new Date() } },
      select: { lockedUntil: true },
    });
    const times = rows.map((r) => r.lockedUntil!.getTime());
    return times.length ? new Date(Math.max(...times)) : null;
  }

  async recordFailure(key: ThrottleKey): Promise<void> {
    const limit = THROTTLE_LIMITS[key.scope];
    const hash = throttleKeyHash(key.scope, key.value);
    const windowMinutes = THROTTLE_WINDOW_MINUTES;
    const lockMinutes = THROTTLE_LOCK_MINUTES;
    await this.prisma.db.$executeRaw`
      INSERT INTO login_throttles (scope, key_hash, failures, window_started_at, locked_until, updated_at)
      VALUES (${key.scope}, ${hash}, 1, now(), NULL, now())
      ON CONFLICT (scope, key_hash) DO UPDATE SET
        failures = CASE WHEN login_throttles.window_started_at < now() - make_interval(mins => ${windowMinutes})
                        THEN 1 ELSE login_throttles.failures + 1 END,
        window_started_at = CASE WHEN login_throttles.window_started_at < now() - make_interval(mins => ${windowMinutes})
                                 THEN now() ELSE login_throttles.window_started_at END,
        locked_until = CASE WHEN (CASE WHEN login_throttles.window_started_at < now() - make_interval(mins => ${windowMinutes})
                                       THEN 1 ELSE login_throttles.failures + 1 END) >= ${limit}
                            THEN now() + make_interval(mins => ${lockMinutes})
                            ELSE login_throttles.locked_until END,
        updated_at = now()`;
  }

  /** A successful sign-in clears that account's counter (the address counter keeps running). */
  async reset(key: ThrottleKey): Promise<void> {
    await this.prisma.db.loginThrottle.updateMany({
      where: { scope: key.scope, keyHash: throttleKeyHash(key.scope, key.value) },
      data: { failures: 0, lockedUntil: null, updatedAt: new Date() },
    });
  }
}
