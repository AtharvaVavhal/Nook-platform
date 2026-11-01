import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type {
  AuthMembershipRecord,
  AuthRepository,
  AuthUserRecord,
  SessionRecord,
} from './auth.types.js';

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findUserByLogin(
    loginIdentifier: string,
  ): Promise<(AuthUserRecord & { memberships: AuthMembershipRecord[] }) | null> {
    const user = await this.prisma.db.user.findUnique({
      where: { loginIdentifier },
      include: { memberships: { include: { organization: true } } },
    });
    return user as (AuthUserRecord & { memberships: AuthMembershipRecord[] }) | null;
  }

  async updateLastLogin(userId: string, lastLoginAt: Date): Promise<void> {
    await this.prisma.db.$executeRaw`
      UPDATE "public"."users"
      SET "last_login_at" = ${lastLoginAt}
      WHERE "id" = ${userId}
    `;
  }

  async createSession(input: {
    tokenHash: string;
    userId: string;
    activeOrganizationId: string;
    createdAt: Date;
    lastSeenAt: Date;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  }): Promise<{ id: string }> {
    return this.prisma.db.session.create({ data: input, select: { id: true } });
  }

  async findSession(tokenHash: string): Promise<
    | (SessionRecord & {
        user: AuthUserRecord;
        membership: AuthMembershipRecord | null;
      })
    | null
  > {
    const session = await this.prisma.db.session.findUnique({
      where: { tokenHash },
      include: {
        user: true,
        membership: { include: { organization: true } },
      },
    });
    return session as
      | (SessionRecord & {
          user: AuthUserRecord;
          membership: AuthMembershipRecord | null;
        })
      | null;
  }

  async touchSession(sessionId: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    await this.prisma.db.session.update({
      where: { id: sessionId },
      data: { lastSeenAt, idleExpiresAt },
    });
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.db.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
