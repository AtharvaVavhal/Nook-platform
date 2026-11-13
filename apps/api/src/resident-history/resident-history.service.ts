import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/client.js';
import { parsePagination } from '../common/ids.js';
import { queryDate, queryEnum } from '../common/input.js';

export interface HistoryEventResponse {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  occurredAt: string;
  actor: { userId: string; displayName: string } | null;
  metadata: Record<string, unknown>;
}

const METADATA_ALLOWLIST: Record<string, string[]> = {
  'booking.created': ['residentId', 'bedId', 'startDate', 'endDate', 'monthlyPrice'],
  'booking.updated': ['changedFields', 'previousValues', 'newValues'],
  'booking.cancelled': ['reason'],
  'booking.extended': [
    'previousEndDate',
    'newEndDate',
    'reason',
    'approvedByUserId',
    'approvedByRole',
    'approvedAt',
  ],
  'booking.shortened': ['previousEndInstant', 'newEndInstant', 'additionalChanges'],
  'admission.created': [
    'bookingId',
    'residentId',
    'bedId',
    'admissionDate',
    'propertyId',
    'roomId',
  ],
  'admission.updated': ['changedFields', 'previousValues', 'newValues'],
  'admission.approved': ['previousStatus', 'approvedByUserId', 'approvedAt'],
  'admission.cancelled': ['previousStatus', 'reason'],
  'admission.reopened': ['previousStatus', 'reopenedByUserId', 'reopenedAt'],
  'checkin.created': ['admissionId', 'residentId', 'bedId', 'bookingId', 'checkInAt'],
  'checkout.created': [
    'checkInId',
    'residentId',
    'bedId',
    'bookingId',
    'checkOutAt',
    'reason',
    'physicalBedId',
    'stayAssignmentId',
  ],
  // Correction events carry identifiers only; protected before/after values stay in the proposal (never in the audit).
  'correction.submitted': ['proposalId', 'fieldKey'],
  'correction.applied': ['proposalId', 'fieldKey'],
  'correction.rejected': ['proposalId', 'fieldKey'],
  'correction.withdrawn': ['proposalId', 'fieldKey'],
  'correction.stale': ['proposalId', 'fieldKey', 'staleCause'],
  'resident.corrected': ['proposalId', 'fieldKey'],
  'booking.corrected': ['proposalId', 'fieldKey'],
  'admission.corrected': ['proposalId', 'fieldKey'],
  'checkin.corrected': ['proposalId', 'fieldKey'],
  'checkout.corrected': ['proposalId', 'fieldKey'],
};

const HISTORY_ACTIONS = Object.keys(METADATA_ALLOWLIST);

@Injectable()
export class ResidentHistoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private projectMetadata(action: string, metadata: Prisma.JsonValue): Record<string, unknown> {
    const allowlist = METADATA_ALLOWLIST[action] ?? [];
    const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<
      string,
      unknown
    >;
    const projected: Record<string, unknown> = {};
    for (const key of allowlist) {
      if (key in meta) {
        projected[key] = meta[key];
      }
    }
    return projected;
  }

  private async getResidentTargetIds(
    organizationId: string,
    residentId: string,
  ): Promise<{
    bookingIds: string[];
    admissionIds: string[];
    checkInIds: string[];
    checkOutIds: string[];
  }> {
    const [bookings, admissions, checkIns, checkOuts] = await Promise.all([
      this.prisma.db.booking.findMany({
        where: { organizationId, residentId },
        select: { id: true },
      }),
      this.prisma.db.admission.findMany({
        where: { organizationId, residentId },
        select: { id: true },
      }),
      this.prisma.db.checkIn.findMany({
        where: { organizationId, residentId },
        select: { id: true },
      }),
      this.prisma.db.checkOut.findMany({
        where: { organizationId, residentId },
        select: { id: true },
      }),
    ]);

    return {
      bookingIds: bookings.map((b) => b.id),
      admissionIds: admissions.map((a) => a.id),
      checkInIds: checkIns.map((c) => c.id),
      checkOutIds: checkOuts.map((c) => c.id),
    };
  }

  private buildAuditEventWhere(
    organizationId: string,
    residentId: string,
    targetIds: {
      bookingIds: string[];
      admissionIds: string[];
      checkInIds: string[];
      checkOutIds: string[];
    },
    actionFilter: string | undefined,
    fromDate: Date | undefined,
    toDate: Date | undefined,
  ): Prisma.AuditEventWhereInput {
    const orConditions: Prisma.AuditEventWhereInput[] = [
      { targetType: 'resident', targetId: { in: [residentId] } },
    ];

    if (targetIds.bookingIds.length > 0) {
      orConditions.push({
        targetType: 'booking',
        targetId: { in: targetIds.bookingIds },
      });
    }
    if (targetIds.admissionIds.length > 0) {
      orConditions.push({
        targetType: 'admission',
        targetId: { in: targetIds.admissionIds },
      });
    }
    if (targetIds.checkInIds.length > 0) {
      orConditions.push({
        targetType: 'check_in',
        targetId: { in: targetIds.checkInIds },
      });
    }
    if (targetIds.checkOutIds.length > 0) {
      orConditions.push({
        targetType: 'check_out',
        targetId: { in: targetIds.checkOutIds },
      });
    }

    const where: Prisma.AuditEventWhereInput = {
      organizationId,
      OR: orConditions,
    };

    if (actionFilter) {
      where.action = actionFilter;
    } else {
      where.action = { in: HISTORY_ACTIONS };
    }

    if (fromDate || toDate) {
      where.occurredAt = {};
      if (fromDate) where.occurredAt.gte = fromDate;
      if (toDate) where.occurredAt.lte = toDate;
    }

    return where;
  }

  async getHistory(
    organizationId: string,
    residentId: string,
    query: Record<string, unknown>,
  ): Promise<{
    items: HistoryEventResponse[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const resident = await this.prisma.db.resident.findFirst({
      where: { id: residentId, organizationId },
      select: { id: true },
    });
    if (!resident) {
      throw new NotFoundException('Resident not found');
    }

    const queryObj = query as Record<string, unknown>;
    const pagination = parsePagination(queryObj.page, queryObj.limit);

    const actionFilter = queryEnum(queryObj, 'action', HISTORY_ACTIONS);
    const fromDate = queryDate(queryObj, 'fromDate');
    const toDate = queryDate(queryObj, 'toDate');

    const targetIds = await this.getResidentTargetIds(organizationId, residentId);

    const where = this.buildAuditEventWhere(
      organizationId,
      residentId,
      targetIds,
      actionFilter,
      fromDate,
      toDate,
    );

    const [events, total] = await Promise.all([
      this.prisma.db.auditEvent.findMany({
        where,
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
        include: { actor: { select: { id: true, displayName: true } } },
      }),
      this.prisma.db.auditEvent.count({ where }),
    ]);

    const items = events.map((event) => ({
      id: event.id,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? '',
      occurredAt: event.occurredAt.toISOString(),
      actor: event.actorUserId
        ? {
            userId: event.actorUserId,
            displayName: event.actor?.displayName ?? '',
          }
        : null,
      metadata: this.projectMetadata(event.action, event.metadata),
    }));

    return {
      items,
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }
}
