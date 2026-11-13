import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/client.js';
import { acquireOrgGate, ORDINARY_TX_OPTIONS } from '../common/org-gate.js';
import { requireUuid, parsePagination } from '../common/ids.js';
import { parseDateOnly } from '../finance/finance.util.js';
import { requestCheck } from '../corrections/corrections.rules.js';
import { auditRequestId } from '../observability/request-context.js';
import { classifyFailure } from '../common/tx-errors.js';

type Tx = Prisma.TransactionClient;
@Injectable()
export class TransferFinanceGate {
  assertCreationConfigured(): void {
    throw new ServiceUnavailableException({ code: 'TRANSFER_FINANCE_POLICY_UNAVAILABLE' });
  }
  assertResolutionConfigured(): void {
    throw new ServiceUnavailableException({ code: 'TRANSFER_FINANCE_POLICY_UNAVAILABLE' });
  }
}
export const TRANSFER_FINANCE_CONFIG = 'TRANSFER_FINANCE_CONFIG';
interface Config {
  receiptSecret(): string | undefined;
}

@Injectable()
export class TransferFinanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransferFinanceGate) private readonly gate: TransferFinanceGate,
    @Optional() @Inject(TRANSFER_FINANCE_CONFIG) private readonly config?: Config,
  ) {}

  /** Trusted transfer policy must supply the affected period; this layer never decides F1's trigger/timing. */
  async recordInTransaction(
    tx: Tx,
    input: {
      organizationId: string;
      transferId: string;
      requestedByUserId: string;
      periodStart: string;
      reason: string;
    },
  ) {
    this.gate.assertCreationConfigured();
    for (const key of ['organizationId', 'transferId', 'requestedByUserId'] as const)
      requireUuid(input[key], key);
    const periodStart = parseDateOnly(input.periodStart, 'periodStart');
    if (periodStart.getUTCDate() !== 1 || !input.reason.trim() || input.reason.trim().length > 2000)
      throw new BadRequestException({ code: 'INVALID_VALUE' });
    const transfer = await tx.transfer.findFirst({
      where: { id: input.transferId, organizationId: input.organizationId },
    });
    if (!transfer) throw new NotFoundException({ code: 'NOT_FOUND' });
    const existing = await tx.transferFinanceReview.findUnique({
      where: {
        organizationId_transferId_periodStart: {
          organizationId: input.organizationId,
          transferId: input.transferId,
          periodStart,
        },
      },
    });
    if (existing) {
      if (
        existing.requestedByUserId !== input.requestedByUserId ||
        existing.reason !== input.reason.trim()
      )
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      return existing;
    }
    const review = await tx.transferFinanceReview.create({
      data: {
        organizationId: input.organizationId,
        transferId: transfer.id,
        bookingId: transfer.bookingId,
        residentId: transfer.residentId,
        requestedByUserId: input.requestedByUserId,
        periodStart,
        reason: input.reason.trim(),
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: transfer.actorUserId,
        action: 'transfer.finance_review.required',
        targetType: 'booking',
        targetId: transfer.bookingId,
        requestId: auditRequestId(),
        metadata: { transferId: transfer.id, reviewId: review.id, periodStart: input.periodStart },
      },
    });
    return review;
  }

  private async authority(tx: Tx, organizationId: string, actorUserId: string) {
    const member = await tx.membership.findFirst({
      where: { organizationId, userId: actorUserId },
      include: { user: { select: { status: true } }, organization: { select: { status: true } } },
    });
    if (
      !member ||
      member.role !== 'OWNER' ||
      member.status !== 'ACTIVE' ||
      member.user.status !== 'ACTIVE' ||
      member.organization.status !== 'ACTIVE'
    ) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
    }
  }

  async list(organizationId: string, actorUserId: string, query: Record<string, unknown>) {
    for (const key of Object.keys(query))
      if (!['residentId', 'bookingId', 'page', 'limit', 'resolved'].includes(key))
        throw new BadRequestException({ code: 'UNKNOWN_FIELD' });
    const { page, limit } = parsePagination(query.page, query.limit);
    if (
      query.resolved !== undefined &&
      (typeof query.resolved !== 'string' || !['true', 'false'].includes(query.resolved))
    )
      throw new BadRequestException({ code: 'INVALID_VALUE' });
    return this.prisma.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await this.authority(tx, organizationId, actorUserId);
        const where = {
          organizationId,
          ...(query.residentId ? { residentId: requireUuid(query.residentId, 'residentId') } : {}),
          ...(query.bookingId ? { bookingId: requireUuid(query.bookingId, 'bookingId') } : {}),
          ...(query.resolved === 'true'
            ? { resolution: { isNot: null } }
            : { resolution: { is: null } }),
        };
        const total = await tx.transferFinanceReview.count({ where });
        const items = await tx.transferFinanceReview.findMany({
          where,
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          include: { resolution: true },
        });
        return {
          items: items.map((item) => ({
            ...item,
            periodStart: item.periodStart.toISOString().slice(0, 10),
            status: item.resolution?.outcome ?? 'REVIEW_REQUIRED',
            allowedActions: [],
          })),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async resolve(
    organizationId: string,
    actorUserId: string,
    reviewId: string,
    key: string,
    body: Record<string, unknown>,
  ) {
    for (const field of Object.keys(body))
      if (!['outcome', 'reason'].includes(field))
        throw new BadRequestException({ code: 'UNKNOWN_FIELD' });
    for (const [field, value] of Object.entries({ organizationId, actorUserId, reviewId, key }))
      requireUuid(value, field);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (
      !['RELEASED', 'NO_SUPPORTED_REMEDY'].includes(String(body.outcome)) ||
      !reason ||
      reason.length > 2000
    )
      throw new BadRequestException({ code: 'INVALID_VALUE' });
    this.gate.assertResolutionConfigured(); // No production resolution until F1 is explicitly approved.
    const secret = this.config
      ? this.config.receiptSecret()
      : process.env.CORRECTION_RECEIPT_SECRET;
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException({ code: 'CORRECTIONS_NOT_CONFIGURED' });
    const check = requestCheck(secret, {
      action: 'TRANSFER_FINANCE_RESOLVE',
      proposalId: reviewId,
      organizationId,
      actorId: actorUserId,
      payload: { outcome: body.outcome, reason },
    });
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('lock_timeout','3000ms',true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`nook:transfer-finance:${organizationId}:${actorUserId}:${key}`},0))`;
        await this.authority(tx, organizationId, actorUserId);
        await acquireOrgGate(tx, organizationId);
        // Authority can be revoked while this command waits for the lifecycle gate, including on replay.
        await this.authority(tx, organizationId, actorUserId);
        // Review rows are immutable and the org gate serializes decisions; no UPDATE privilege is needed.
        const review = await tx.transferFinanceReview.findFirst({
          where: { id: reviewId, organizationId },
        });
        if (!review) throw new NotFoundException({ code: 'NOT_FOUND' });
        if (review.requestedByUserId === actorUserId)
          throw new ForbiddenException({ code: 'SELF_REVIEW' });
        const replay = await tx.transferFinanceResolution.findUnique({
          where: {
            organizationId_actorUserId_idempotencyKey: {
              organizationId,
              actorUserId,
              idempotencyKey: key,
            },
          },
        });
        if (replay) {
          if (replay.requestCheck !== check || replay.reviewId !== reviewId)
            throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
          return replay;
        }
        if (await tx.transferFinanceResolution.findUnique({ where: { reviewId } }))
          throw new ConflictException({ code: 'INVALID_STATE' });
        const result = await tx.transferFinanceResolution.create({
          data: {
            organizationId,
            reviewId,
            actorUserId,
            outcome: String(body.outcome),
            reason,
            idempotencyKey: key,
            requestCheck: check,
          },
        });
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId,
            action: 'transfer.finance_review.resolved',
            targetType: 'booking',
            targetId: review.bookingId,
            requestId: auditRequestId(),
            metadata: {
              reviewId,
              transferId: review.transferId,
              resolutionId: result.id,
              outcome: result.outcome,
            },
          },
        });
        return result;
      }, ORDINARY_TX_OPTIONS);
    } catch (error) {
      const failure = classifyFailure(error);
      if (['LOCK_TIMEOUT', 'UNCERTAIN', 'DEADLOCK', 'SERIALIZATION'].includes(failure))
        throw new ConflictException({ code: 'RETRY_REQUIRED' });
      if (failure === 'UNIQUE_VIOLATION') throw new ConflictException({ code: 'CONFLICT' });
      throw error;
    }
  }
}
