import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/client.js';

export type AuthAuditAction =
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.login.throttled'
  | 'auth.logout'
  | 'auth.password.changed'
  | 'auth.password.change_failed';

/**
 * Authentication audit trail in `audit_events`. Metadata never contains a password, a hash, a session
 * secret, an e-mail address or an IP address; unknown identifiers appear only as a short one-way tag.
 */
@Injectable()
export class AuthAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Best effort: a failure to write an audit row must never block or change the sign-in outcome. */
  async record(
    action: AuthAuditAction,
    entry: {
      organizationId?: string | null;
      actorUserId?: string | null;
      targetId?: string | null;
      metadata?: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    try {
      await this.prisma.db.auditEvent.create({
        data: {
          organizationId: entry.organizationId ?? null,
          actorUserId: entry.actorUserId ?? null,
          action,
          targetType: 'user',
          targetId: entry.targetId ?? entry.actorUserId ?? null,
          requestId: randomUUID(),
          metadata: entry.metadata ?? {},
        },
      });
    } catch (error) {
      console.error(
        'auth audit write failed',
        action,
        (error as { code?: string }).code ?? 'unknown',
      );
    }
  }
}
