import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/client.js';
import { acquireOrgGate, CORRECTION_TX_OPTIONS, setLocalLockTimeout } from '../common/org-gate.js';
import { correctionDeadlineClient } from '../common/correction-deadline.js';
import { classifyFailure, isAutoRetryable, sqlStates } from '../common/tx-errors.js';
import { requireUuid } from '../common/ids.js';
import { istStartOfDay } from '../common/time.js';
import { requestCheck } from '../corrections/corrections.rules.js';
import { auditRequestId } from '../observability/request-context.js';

type Tx = Prisma.TransactionClient;
export interface TransferCommand {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  residentId: string;
  destinationBedId: string;
  reason: string;
  effectiveAt: Date;
  idempotencyKey: string;
}
export interface TransferApproval {
  /** Must be resolved from durable server-side approval state, never accepted from the request body. */
  approvalId: string;
  requestedByUserId: string;
  approvedByUserId: string;
  sourceAssignmentId: string;
  bookingId: string;
}

/** No runtime activation switch: missing approval, finance and rollout contracts always fail closed. */
@Injectable()
export class TransferExecutionGate {
  assertConfigured(): void {
    throw new ServiceUnavailableException({
      code: 'TRANSFER_EXECUTION_UNAVAILABLE',
      blockers: ['REQUESTER_REVIEWER_CONTRACT', 'ASSIGNMENT_CONSUMER_ROLLOUT'],
    });
  }
  async authorize(
    _tx: Tx,
    _command: TransferCommand,
    _replayTransferId?: string,
  ): Promise<TransferApproval> {
    void _tx;
    void _command;
    void _replayTransferId;
    this.assertConfigured();
    throw new ServiceUnavailableException({ code: 'TRANSFER_EXECUTION_UNAVAILABLE' });
  }
  async validateFinance(
    _tx: Tx,
    _command: TransferCommand,
    _approval: TransferApproval,
  ): Promise<void> {
    void _tx;
    void _command;
    void _approval;
    this.assertConfigured();
    throw new ServiceUnavailableException({ code: 'TRANSFER_FINANCE_LINK_UNAVAILABLE' });
  }
  async recordFinanceReview(
    _tx: Tx,
    _transferId: string,
    _command: TransferCommand,
    _approval: TransferApproval,
  ): Promise<void> {
    void _tx;
    void _transferId;
    void _command;
    void _approval;
    this.assertConfigured();
    throw new ServiceUnavailableException({ code: 'TRANSFER_FINANCE_LINK_UNAVAILABLE' });
  }
}

interface ExecutionConfig {
  receiptSecret(): string | undefined;
  sleep?(ms: number): Promise<void>;
}
export const TRANSFER_EXECUTION_CONFIG = 'TRANSFER_EXECUTION_CONFIG';

/** Mechanical transaction infrastructure. The production gate above cannot grant execution authority. */
@Injectable()
export class TransferExecutionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransferExecutionGate) private readonly gate: TransferExecutionGate,
    @Optional() @Inject(TRANSFER_EXECUTION_CONFIG) private readonly config?: ExecutionConfig,
  ) {}

  async execute(raw: TransferCommand): Promise<Prisma.JsonValue> {
    for (const key of [
      'organizationId',
      'actorUserId',
      'residentId',
      'destinationBedId',
      'idempotencyKey',
    ] as const)
      requireUuid(raw[key], key);
    if (!['OWNER', 'PROPERTY_MANAGER'].includes(raw.actorRole))
      throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
    if (
      typeof raw.reason !== 'string' ||
      !raw.reason.trim() ||
      raw.reason.trim().length > 2000 ||
      !(raw.effectiveAt instanceof Date) ||
      !Number.isFinite(raw.effectiveAt.getTime())
    )
      throw new BadRequestException({ code: 'INVALID_VALUE' });
    this.gate.assertConfigured(); // Before obtaining a connection, including in the real HTTP path.
    const secret = this.config?.receiptSecret() ?? process.env.CORRECTION_RECEIPT_SECRET;
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException({ code: 'CORRECTIONS_NOT_CONFIGURED' });
    const command = { ...raw, reason: raw.reason.trim() };
    const check = requestCheck(secret, {
      action: 'TRANSFER',
      proposalId: null,
      organizationId: command.organizationId,
      actorId: command.actorUserId,
      payload: {
        residentId: command.residentId,
        destinationBedId: command.destinationBedId,
        reason: command.reason,
        effectiveAt: command.effectiveAt.toISOString(),
      },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      try {
        return await this.prisma.db.$transaction(async (rawTx) => {
          const tx = correctionDeadlineClient(
            rawTx,
            CORRECTION_TX_OPTIONS.timeout - (Date.now() - started),
          );
          await setLocalLockTimeout(tx, 5000);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`nook:transfer-command:${command.organizationId}:${command.actorUserId}:${command.idempotencyKey}`}, 0))`;
          const authority = await tx.membership.findFirst({
            where: { organizationId: command.organizationId, userId: command.actorUserId },
            include: {
              user: { select: { status: true } },
              organization: { select: { status: true } },
            },
          });
          if (
            !authority ||
            authority.status !== 'ACTIVE' ||
            authority.user.status !== 'ACTIVE' ||
            authority.organization.status !== 'ACTIVE' ||
            !['OWNER', 'PROPERTY_MANAGER'].includes(authority.role)
          )
            throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
          const trustedCommand = { ...command, actorRole: authority.role };
          const receipt = await tx.transferCommandReceipt.findUnique({
            where: {
              organizationId_actorId_idempotencyKey: {
                organizationId: command.organizationId,
                actorId: command.actorUserId,
                idempotencyKey: command.idempotencyKey,
              },
            },
          });
          if (receipt && (receipt.requestCheck !== check || receipt.responseVersion !== 1))
            throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
          await acquireOrgGate(tx, command.organizationId, { lockTimeoutMs: 5000 });
          const approval = await this.gate.authorize(tx, trustedCommand, receipt?.transferId);
          for (const key of [
            'approvalId',
            'requestedByUserId',
            'approvedByUserId',
            'sourceAssignmentId',
            'bookingId',
          ] as const)
            requireUuid(approval[key], key);
          if (approval.requestedByUserId === command.actorUserId)
            throw new ForbiddenException({ code: 'SELF_REVIEW' });
          if (approval.approvedByUserId !== command.actorUserId)
            throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
          if (receipt) {
            const transfer = await tx.transfer.findFirst({
              where: {
                id: receipt.transferId,
                organizationId: command.organizationId,
                residentId: command.residentId,
                bookingId: approval.bookingId,
                actorUserId: command.actorUserId,
              },
            });
            if (!transfer) throw new ConflictException({ code: 'CONFLICT' });
            await tx.$executeRaw`SELECT 1`;
            return receipt.responseBody;
          }
          const result = await this.apply(tx, trustedCommand, approval);
          await tx.transferCommandReceipt.create({
            data: {
              organizationId: command.organizationId,
              actorId: command.actorUserId,
              idempotencyKey: command.idempotencyKey,
              transferId: result.id,
              requestCheck: check,
              responseVersion: 1,
              responseBody: result,
            },
          });
          await tx.$executeRaw`SELECT 1`;
          return result;
        }, CORRECTION_TX_OPTIONS);
      } catch (error) {
        if (error instanceof HttpException) throw error;
        const failure = classifyFailure(error);
        if (isAutoRetryable(failure) && attempt === 0) {
          await (this.config?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
            50,
          );
          continue;
        }
        if (
          sqlStates(error).includes('23P01') ||
          failure === 'UNIQUE_VIOLATION' ||
          failure === 'FOREIGN_KEY_VIOLATION'
        ) {
          throw new ConflictException({
            code: 'CONFLICT',
            message: 'An assignment or related record changed. Refresh the preview.',
          });
        }
        if (isAutoRetryable(failure) || failure === 'LOCK_TIMEOUT' || failure === 'UNCERTAIN') {
          throw new ConflictException({
            code: 'RETRY_REQUIRED',
            message: 'Retry with the same Idempotency-Key.',
          });
        }
        throw error;
      }
    }
    throw new ConflictException({ code: 'RETRY_REQUIRED' });
  }

  private async apply(tx: Tx, command: TransferCommand, approval: TransferApproval) {
    const { organizationId: org, residentId, destinationBedId, effectiveAt } = command;
    await tx.$queryRaw`SELECT id FROM stay_assignments WHERE id = ${approval.sourceAssignmentId}::uuid AND organization_id = ${org}::uuid FOR UPDATE`;
    const source = await tx.effectiveStayAssignment.findFirst({
      where: {
        id: approval.sourceAssignmentId,
        organizationId: org,
        residentId,
        bookingId: approval.bookingId,
        status: 'ACTIVE',
        endAt: null,
      },
    });
    if (!source)
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'The approved source assignment is no longer current.',
      });
    if (
      (await tx.effectiveStayAssignment.count({
        where: { organizationId: org, bookingId: source.bookingId, status: 'ACTIVE', endAt: null },
      })) !== 1
    ) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'The active assignment chain requires review.',
      });
    }
    if (source.bedId === destinationBedId)
      throw new ConflictException({ code: 'CONFLICT', message: 'Destination is the current bed.' });
    for (const bed of [source.bedId, destinationBedId].sort()) {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM beds WHERE id = ${bed}::uuid AND organization_id = ${org}::uuid FOR UPDATE`;
      if (!rows.length) throw new ConflictException({ code: 'CONFLICT' });
    }
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${source.bookingId}::uuid AND organization_id = ${org}::uuid FOR UPDATE`;
    const stays = await tx.checkIn.findMany({
      where: { organizationId: org, residentId, status: 'ACTIVE', checkOut: null },
      take: 2,
      include: { booking: true, admission: true, resident: { select: { status: true } } },
    });
    const stay = stays[0];
    if (
      stays.length !== 1 ||
      !stay ||
      stay.bookingId !== source.bookingId ||
      stay.booking.status !== 'CONFIRMED' ||
      stay.admission.status !== 'ADMITTED' ||
      stay.resident.status !== 'ACTIVE'
    )
      throw new ConflictException({ code: 'CONFLICT' });
    await tx.$queryRaw`SELECT id FROM admissions WHERE id = ${stay.admissionId}::uuid AND organization_id = ${org}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM check_ins WHERE id = ${stay.id}::uuid AND organization_id = ${org}::uuid FOR UPDATE`;
    const nowRows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const now = nowRows[0]!.now;
    if (
      effectiveAt > now ||
      effectiveAt <= source.startAt ||
      effectiveAt < stay.checkInAt ||
      effectiveAt < istStartOfDay(stay.booking.startDate) ||
      effectiveAt >= istStartOfDay(stay.booking.endDate) ||
      now >= istStartOfDay(stay.booking.endDate)
    ) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Effective time is outside the approved active interval.',
      });
    }
    const include = { room: { include: { floor: { include: { property: true } } } } } as const;
    const beds = await tx.bed.findMany({
      where: { organizationId: org, id: { in: [source.bedId, destinationBedId] } },
      include,
    });
    const from = beds.find((b) => b.id === source.bedId)!,
      dest = beds.find((b) => b.id === destinationBedId)!;
    if (
      !from ||
      !dest ||
      dest.operationalStatus !== 'IN_SERVICE' ||
      dest.archivedAt ||
      dest.room.archivedAt ||
      dest.room.floor.archivedAt ||
      dest.room.floor.property.archivedAt
    )
      throw new ConflictException({ code: 'CONFLICT' });
    // This infrastructure has no support for extended execution, regardless of a future policy adapter.
    if (
      from.propertyId !== dest.propertyId ||
      !from.price.equals(dest.price) ||
      stay.booking.paymentStatus === 'OVERDUE'
    ) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Extended transfer execution is disabled.',
      });
    }
    const end = istStartOfDay(stay.booking.endDate);
    const collisions = await tx.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM effective_stay_assignments s WHERE s.organization_id = ${org}::uuid AND s.bed_id = ${destinationBedId}::uuid
        AND s.start_at < ${end} AND COALESCE(s.end_at, 'infinity'::timestamptz) > ${effectiveAt}
      UNION ALL
      SELECT b.id FROM bookings b WHERE b.organization_id = ${org}::uuid AND b.bed_id = ${destinationBedId}::uuid
        AND b.id <> ${source.bookingId}::uuid AND b.status = 'CONFIRMED'
        AND ((b.start_date AT TIME ZONE 'Asia/Kolkata')::date::timestamp AT TIME ZONE 'Asia/Kolkata') < ${end}
        AND ((b.end_date AT TIME ZONE 'Asia/Kolkata')::date::timestamp AT TIME ZONE 'Asia/Kolkata') > ${effectiveAt}
      UNION ALL
      SELECT c.id FROM check_ins c WHERE c.organization_id = ${org}::uuid AND c.bed_id = ${destinationBedId}::uuid
        AND c.status = 'ACTIVE' AND c.check_in_at < ${end}
        AND NOT EXISTS (SELECT 1 FROM check_outs o WHERE o.organization_id = c.organization_id AND o.check_in_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM stay_assignments s WHERE s.organization_id = c.organization_id AND s.booking_id = c.booking_id)
      LIMIT 1`;
    if (collisions.length)
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Destination is no longer available.',
      });
    await this.gate.validateFinance(tx, command, approval);
    const transfer = await tx.transfer.create({
      data: {
        organizationId: org,
        residentId,
        bookingId: source.bookingId,
        type: from.roomId === dest.roomId ? 'BED_TRANSFER' : 'ROOM_TRANSFER',
        sourceBedId: from.id,
        sourceRoomId: from.roomId,
        sourcePropertyId: from.propertyId,
        destinationBedId: dest.id,
        destinationRoomId: dest.roomId,
        destinationPropertyId: dest.propertyId,
        reason: command.reason,
        effectiveAt,
        actorUserId: command.actorUserId,
        actorRole: command.actorRole as 'OWNER' | 'PROPERTY_MANAGER',
        idempotencyKey: command.idempotencyKey,
      },
    });
    const closed = await tx.stayAssignment.updateMany({
      where: { id: source.id, organizationId: org, status: 'ACTIVE', endAt: null },
      data: { status: 'COMPLETED', endAt: effectiveAt },
    });
    if (closed.count !== 1) throw new ConflictException({ code: 'CONFLICT' });
    const assignment = await tx.stayAssignment.create({
      data: {
        organizationId: org,
        residentId,
        bookingId: source.bookingId,
        bedId: dest.id,
        kind: 'TRANSFER',
        status: 'ACTIVE',
        startAt: effectiveAt,
        transferId: transfer.id,
      },
    });
    await this.gate.recordFinanceReview(tx, transfer.id, command, approval);
    const events = [
      {
        action: 'transfer.executed',
        targetType: 'booking',
        targetId: source.bookingId,
        metadata: {
          transferId: transfer.id,
          type: transfer.type,
          sourceBedId: source.bedId,
          destinationBedId,
          effectiveAt: effectiveAt.toISOString(),
          reason: command.reason,
          actorUserId: command.actorUserId,
          approvalId: approval.approvalId,
          requestedByUserId: approval.requestedByUserId,
        },
      },
      {
        action: 'stay_assignment.closed',
        targetType: 'stay_assignment',
        targetId: source.id,
        metadata: { transferId: transfer.id, endAt: effectiveAt.toISOString() },
      },
      {
        action: 'stay_assignment.opened',
        targetType: 'stay_assignment',
        targetId: assignment.id,
        metadata: { transferId: transfer.id, startAt: effectiveAt.toISOString() },
      },
    ];
    for (const event of events)
      await tx.auditEvent.create({
        data: {
          ...event,
          organizationId: org,
          actorUserId: command.actorUserId,
          requestId: auditRequestId(),
          metadata: event.metadata as Prisma.InputJsonObject,
        },
      });
    return {
      id: transfer.id,
      type: transfer.type,
      sourceBedId: source.bedId,
      destinationBedId,
      effectiveAt: transfer.effectiveAt.toISOString(),
      recordedAt: transfer.recordedAt.toISOString(),
      stayAssignment: {
        id: assignment.id,
        bedId: assignment.bedId,
        startAt: assignment.startAt.toISOString(),
        endAt: null,
      },
    };
  }
}
