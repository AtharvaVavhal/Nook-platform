import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedContext } from '../auth/auth.types.js';
import {
  optionalText,
  requireObject,
  requireUuid,
  asQuery,
  queryEnum,
  queryUuid,
} from '../common/input.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/client.js';
import { maskPhone, normalizeIndianMobile } from '../resident-auth/phone.js';
import {
  ResidentAuditService,
  type ResidentAuditAction,
} from '../resident-auth/resident-audit.service.js';

const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
const MAX_REASON = 200;
const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002';

type Action = 'suspend' | 'revoke' | 'reactivate';

/**
 * Owner-authorized resident portal access. A resident cannot create, change or revoke an account: these methods run only for a
 * signed-in OWNER, always inside the owner's own organization, and every change writes its audit row in the same transaction.
 * Responses carry the account's own fields only (a masked phone, never a document, address or any other resident detail).
 */
@Injectable()
export class ResidentAccountService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ResidentAuditService) private readonly audit: ResidentAuditService,
  ) {}

  private requireOwner(auth: AuthenticatedContext): void {
    if (auth.role !== 'OWNER') throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
  }

  private view(a: {
    id: string;
    residentId: string;
    phoneE164: string;
    status: string;
    createdAt: Date;
    suspendedAt: Date | null;
    revokedAt: Date | null;
    lastLoginAt: Date | null;
    resident?: { firstName: string; lastName: string } | null;
  }) {
    return {
      id: a.id,
      residentId: a.residentId,
      ...(a.resident
        ? { residentName: `${a.resident.firstName} ${a.resident.lastName}`.trim() }
        : {}),
      phone: maskPhone(a.phoneE164),
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      suspendedAt: a.suspendedAt?.toISOString() ?? null,
      revokedAt: a.revokedAt?.toISOString() ?? null,
      lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
    };
  }

  /** Sessions and unused codes die with the access that granted them. */
  private async endAccess(
    tx: Prisma.TransactionClient,
    accountId: string,
    reason: string,
    now: Date,
  ) {
    await tx.residentSession.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    await tx.residentOtpChallenge.updateMany({
      where: { accountId, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now, invalidatedReason: reason },
    });
  }

  async provision(auth: AuthenticatedContext, body: unknown) {
    this.requireOwner(auth);
    const input = requireObject(body);
    const residentId = requireUuid(input.residentId, 'residentId');
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const resident = await tx.resident.findFirst({
          where: { id: residentId, organizationId: auth.organizationId },
          select: { id: true, status: true, phone: true },
        });
        if (!resident) throw new NotFoundException('Resident not found');
        if (resident.status !== 'ACTIVE')
          throw new ConflictException({ code: 'RESIDENT_NOT_ACTIVE' });
        const phone = normalizeIndianMobile(input.phone ?? resident.phone);
        if (!phone) throw new BadRequestException({ code: 'PHONE_REQUIRED_OR_INVALID' });
        const open = await tx.residentAccount.findFirst({
          where: { residentId, organizationId: auth.organizationId, status: { not: 'REVOKED' } },
          select: { id: true },
        });
        if (open) throw new ConflictException({ code: 'RESIDENT_ALREADY_HAS_ACCESS' });
        // The same answer whether the number belongs to this organization or another: nothing about other organizations leaks.
        const taken = await tx.residentAccount.findFirst({
          where: { phoneE164: phone, status: { not: 'REVOKED' } },
          select: { id: true },
        });
        if (taken) throw new ConflictException({ code: 'PHONE_NOT_AVAILABLE' });
        const account = await tx.residentAccount.create({
          data: {
            organizationId: auth.organizationId,
            residentId,
            phoneE164: phone,
            createdByUserId: auth.userId,
          },
        });
        await this.audit.recordIn(tx, 'resident_account.provisioned', {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          accountId: account.id,
          metadata: { residentId },
        });
        return { data: this.view(account) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException({ code: 'PHONE_NOT_AVAILABLE' });
      throw error;
    }
  }

  async list(auth: AuthenticatedContext, rawQuery: unknown) {
    const query = asQuery(rawQuery);
    const residentId = queryUuid(query, 'residentId');
    const status = queryEnum(query, 'status', ACCOUNT_STATUSES);
    const items = await this.prisma.db.residentAccount.findMany({
      where: {
        organizationId: auth.organizationId,
        ...(residentId ? { residentId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { resident: { select: { firstName: true, lastName: true } } },
    });
    return { data: { items: items.map((a) => this.view(a)) } };
  }

  async changeStatus(auth: AuthenticatedContext, id: string, action: Action, body: unknown) {
    this.requireOwner(auth);
    const input = body === undefined || body === null ? {} : requireObject(body);
    const reason = optionalText(input, 'reason', MAX_REASON) ?? null;
    const now = new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const account = await tx.residentAccount.findFirst({
        where: { id, organizationId: auth.organizationId },
        include: { resident: { select: { status: true, firstName: true, lastName: true } } },
      });
      if (!account) throw new NotFoundException('Resident account not found');
      const invalid = () => new ConflictException({ code: 'INVALID_ACCOUNT_STATE' });
      let data: Prisma.ResidentAccountUpdateInput;
      let audited: ResidentAuditAction;
      if (action === 'suspend') {
        if (account.status !== 'ACTIVE') throw invalid();
        data = { status: 'SUSPENDED', suspendedAt: now };
        audited = 'resident_account.suspended';
      } else if (action === 'revoke') {
        // Revoking is permanent for this account; access can be granted again only by provisioning a new account.
        if (account.status === 'REVOKED') throw invalid();
        data = { status: 'REVOKED', revokedAt: now, suspendedAt: null };
        audited = 'resident_account.revoked';
      } else {
        if (account.status !== 'SUSPENDED' || account.resident.status !== 'ACTIVE') throw invalid();
        data = { status: 'ACTIVE', suspendedAt: null };
        audited = 'resident_account.reactivated';
      }
      const updated = await tx.residentAccount.update({
        where: { id_organizationId: { id, organizationId: auth.organizationId } },
        data,
      });
      if (action !== 'reactivate') {
        await this.endAccess(
          tx,
          id,
          action === 'suspend' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REVOKED',
          now,
        );
      }
      await this.audit.recordIn(tx, audited, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        accountId: id,
        reasonCode: reason,
        metadata: { residentId: account.residentId },
      });
      return { data: this.view({ ...updated, resident: account.resident }) };
    });
  }

  async changePhone(auth: AuthenticatedContext, id: string, body: unknown) {
    this.requireOwner(auth);
    const phone = normalizeIndianMobile(requireObject(body).phone);
    if (!phone) throw new BadRequestException({ code: 'PHONE_REQUIRED_OR_INVALID' });
    const now = new Date();
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const account = await tx.residentAccount.findFirst({
          where: { id, organizationId: auth.organizationId },
        });
        if (!account) throw new NotFoundException('Resident account not found');
        if (account.status === 'REVOKED')
          throw new ConflictException({ code: 'INVALID_ACCOUNT_STATE' });
        if (account.phoneE164 === phone) throw new ConflictException({ code: 'PHONE_UNCHANGED' });
        const taken = await tx.residentAccount.findFirst({
          where: { phoneE164: phone, status: { not: 'REVOKED' }, NOT: { id } },
          select: { id: true },
        });
        if (taken) throw new ConflictException({ code: 'PHONE_NOT_AVAILABLE' });
        const updated = await tx.residentAccount.update({
          where: { id_organizationId: { id, organizationId: auth.organizationId } },
          data: { phoneE164: phone },
        });
        // A new number is a new identity for sign-in: nothing issued to the old one may keep working.
        await this.endAccess(tx, id, 'PHONE_CHANGED', now);
        await this.audit.recordIn(tx, 'resident_account.phone_changed', {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          accountId: id,
          metadata: { residentId: account.residentId },
        });
        return { data: this.view(updated) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException({ code: 'PHONE_NOT_AVAILABLE' });
      throw error;
    }
  }
}
