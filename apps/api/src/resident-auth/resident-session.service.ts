import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/client.js';
import { RESIDENT_SESSION_ABSOLUTE_MS, RESIDENT_SESSION_IDLE_MS } from './policy.js';
import type { ResidentAuthContext } from './resident-auth.types.js';

export function hashResidentSessionSecret(secret: string): string {
  return createHash('sha256').update(`resident-session:${secret}`, 'utf8').digest('hex');
}

/**
 * Server-side resident sessions in their own table. The cookie holds a random secret; only its hash is stored. Every request
 * re-checks the account, the organization and the resident, so suspending any of them ends access immediately.
 */
@Injectable()
export class ResidentSessionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Used inside the verification transaction so consuming the code and creating the session are one atomic step. */
  async createIn(
    tx: Pick<Prisma.TransactionClient, 'residentSession'>,
    accountId: string,
    organizationId: string,
    now = new Date(),
  ): Promise<{
    readonly secret: string;
    readonly sessionId: string;
    readonly absoluteExpiresAt: Date;
  }> {
    const secret = randomBytes(32).toString('base64url');
    const absoluteExpiresAt = new Date(now.getTime() + RESIDENT_SESSION_ABSOLUTE_MS);
    const row = await tx.residentSession.create({
      data: {
        tokenHash: hashResidentSessionSecret(secret),
        organizationId,
        accountId,
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + RESIDENT_SESSION_IDLE_MS),
        absoluteExpiresAt,
      },
      select: { id: true },
    });
    return { secret, sessionId: row.id, absoluteExpiresAt };
  }

  private async load(secret: string) {
    if (!secret) return null;
    return this.prisma.db.residentSession.findUnique({
      where: { tokenHash: hashResidentSessionSecret(secret) },
      include: {
        account: {
          include: {
            resident: { select: { id: true, firstName: true, lastName: true, status: true } },
            organization: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });
  }

  private contextOf(
    session: NonNullable<Awaited<ReturnType<ResidentSessionService['load']>>>,
    now: number,
  ): ResidentAuthContext | null {
    const { account } = session;
    if (
      session.revokedAt ||
      now >= session.idleExpiresAt.getTime() ||
      now >= session.absoluteExpiresAt.getTime() ||
      account.status !== 'ACTIVE' ||
      account.organization.status !== 'ACTIVE' ||
      account.resident.status !== 'ACTIVE' ||
      session.organizationId !== account.organizationId
    ) {
      return null;
    }
    return {
      sessionId: session.id,
      accountId: account.id,
      residentId: account.resident.id,
      organizationId: account.organizationId,
      organizationName: account.organization.name,
      displayName: `${account.resident.firstName} ${account.resident.lastName}`.trim(),
    };
  }

  /** Validates the session and slides the idle expiry (never past the absolute expiry). */
  async authenticate(secret: string): Promise<ResidentAuthContext | null> {
    const session = await this.load(secret);
    if (!session) return null;
    const now = Date.now();
    const context = this.contextOf(session, now);
    if (!context) {
      // A live session refused because the account, organization or resident is no longer eligible (for example the resident
      // became INACTIVE) is ended for good, so later re-activation cannot silently bring an old session back to life.
      const live =
        !session.revokedAt &&
        now < session.idleExpiresAt.getTime() &&
        now < session.absoluteExpiresAt.getTime();
      if (live) await this.revoke(session.id, 'PORTAL_INELIGIBLE');
      return null;
    }
    await this.prisma.db.residentSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: new Date(now),
        idleExpiresAt: new Date(
          Math.min(now + RESIDENT_SESSION_IDLE_MS, session.absoluteExpiresAt.getTime()),
        ),
      },
    });
    return context;
  }

  /** Same checks without touching the session: used to recognise a resident calling a staff route. */
  async identify(secret: string): Promise<ResidentAuthContext | null> {
    const session = await this.load(secret);
    return session ? this.contextOf(session, Date.now()) : null;
  }

  async revoke(sessionId: string, reason = 'logout'): Promise<void> {
    await this.prisma.db.residentSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
