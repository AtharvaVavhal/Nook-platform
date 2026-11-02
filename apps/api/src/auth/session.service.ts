import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AUTH_REPOSITORY } from './auth.repository.js';
import type { AuthRepository, AuthenticatedContext } from './auth.types.js';

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;

export function hashSessionSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

@Injectable()
export class SessionService {
  constructor(@Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository) {}

  async create(
    userId: string,
    organizationId: string,
  ): Promise<{
    readonly secret: string;
    readonly sessionId: string;
  }> {
    const now = new Date();
    const secret = randomBytes(32).toString('base64url');
    const created = await this.repository.createSession({
      tokenHash: hashSessionSecret(secret),
      userId,
      activeOrganizationId: organizationId,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    });
    return { secret, sessionId: created.id };
  }

  async authenticate(secret: string): Promise<AuthenticatedContext | null> {
    if (!secret) return null;
    const session = await this.repository.findSession(hashSessionSecret(secret));
    if (!session || session.revokedAt) return null;
    const now = Date.now();
    if (
      now >= session.idleExpiresAt.getTime() ||
      now >= session.absoluteExpiresAt.getTime() ||
      session.user.status !== 'ACTIVE' ||
      !session.membership ||
      session.membership.status !== 'ACTIVE' ||
      session.membership.organization.status !== 'ACTIVE' ||
      session.activeOrganizationId !== session.membership.organizationId
    ) {
      return null;
    }
    const lastSeenAt = new Date(now);
    const idleExpiresAt = new Date(
      Math.min(now + SESSION_IDLE_MS, session.absoluteExpiresAt.getTime()),
    );
    await this.repository.touchSession(session.id, lastSeenAt, idleExpiresAt);
    return {
      sessionId: session.id,
      userId: session.user.id,
      organizationId: session.membership.organizationId,
      organizationName: session.membership.organization.name,
      displayName: session.user.displayName,
      role: session.membership.role,
      passwordChangeRequired: session.user.passwordChangeRequired,
    };
  }

  async revoke(sessionId: string, reason = 'logout'): Promise<void> {
    await this.repository.revokeSession(sessionId, reason);
  }
}
