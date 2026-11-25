import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/client.js';
import { log } from '../observability/json-logger.js';
import { auditRequestId } from '../observability/request-context.js';

export type ResidentAuditAction =
  | 'resident_account.provisioned'
  | 'resident_account.suspended'
  | 'resident_account.revoked'
  | 'resident_account.reactivated'
  | 'resident_account.phone_changed'
  | 'resident_auth.login.succeeded'
  | 'resident_auth.login.failed'
  | 'resident_auth.logout';

export interface ResidentAuditEntry {
  readonly organizationId: string;
  /** The owner or manager who acted. Absent for the resident's own sign-in events. */
  readonly actorUserId?: string | null;
  readonly accountId: string;
  readonly reasonCode?: string | null;
  /** Never a phone number, a code, a hash, a cookie or an address. */
  readonly metadata?: Prisma.InputJsonObject;
}

/** Trail in `audit_events` (append-only). Metadata never carries a phone number, a code or a secret. */
@Injectable()
export class ResidentAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private data(action: ResidentAuditAction, entry: ResidentAuditEntry) {
    return {
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId ?? null,
      action,
      targetType: 'resident_account',
      targetId: entry.accountId,
      requestId: auditRequestId(),
      reasonCode: entry.reasonCode ?? null,
      metadata: entry.metadata ?? {},
    };
  }

  /** Administrative changes: written inside the caller's transaction, so a change and its audit row succeed or fail together. */
  async recordIn(
    tx: Pick<Prisma.TransactionClient, 'auditEvent'>,
    action: ResidentAuditAction,
    entry: ResidentAuditEntry,
  ): Promise<void> {
    await tx.auditEvent.create({ data: this.data(action, entry) });
  }

  /** Sign-in events: best effort, a failed audit write never changes the sign-in outcome. */
  async record(action: ResidentAuditAction, entry: ResidentAuditEntry): Promise<void> {
    try {
      await this.prisma.db.auditEvent.create({ data: this.data(action, entry) });
    } catch (error) {
      log.error('resident audit write failed', {
        context: 'resident-audit',
        action,
        errorCode: (error as { code?: string }).code ?? 'unknown',
      });
    }
  }
}
