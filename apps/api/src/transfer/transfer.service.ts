import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/client.js';
import { parsePagination, requireUuid } from '../common/ids.js';
import { istStartOfDay, IST_OFFSET_MS } from '../common/time.js';
import { TransferExecutionService } from './transfer.execution.js';
import { transferFinancePreview } from './transfer.finance.js';

type Tx = Prisma.TransactionClient;

interface TransferPreviewInput {
  organizationId: string;
  residentId: string;
  destinationBedId: string;
  effectiveAt?: Date;
}

interface CurrentAssignmentInfo {
  stayAssignmentId: string;
  bedId: string;
  bedLabel: string;
  roomId: string;
  roomLabel: string;
  propertyId: string;
  propertyName: string;
  startAt: Date;
  endAt: Date | null;
}

interface DestinationBedInfo {
  bedId: string;
  bedLabel: string;
  roomId: string;
  roomLabel: string;
  propertyId: string;
  propertyName: string;
  operationalStatus: string;
}

interface BookingInfo {
  id: string;
  monthlyPrice: Prisma.Decimal;
  startDate: Date;
  endDate: Date;
}

interface ConflictInfo {
  bedId: string;
  checkInId?: string;
  assignmentId?: string;
  bookingId?: string;
  checkInAt: Date;
  checkOutAt: Date | null;
}

export interface TransferPreviewResult {
  advisory: true;
  executionEnabled: false;
  allowedActions: ['preview'];
  executionBlockers: string[];
  effectiveAt: Date;
  finance: ReturnType<typeof transferFinancePreview>;
  available: boolean;
  conflicts: ConflictInfo[];
  currentAssignment: CurrentAssignmentInfo;
  destination: DestinationBedInfo;
  transferType: 'ROOM_TRANSFER' | 'BED_TRANSFER';
  booking: BookingInfo;
  staleState: string | null;
  unresolvedDecisions: string[];
}

@Injectable()
export class TransferService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(TransferExecutionService)
    private readonly execution?: TransferExecutionService,
  ) {}

  /**
   * Preview a potential transfer - read-only advisory check.
   * Does not create any records or modify any data.
   */
  async preview(input: TransferPreviewInput): Promise<TransferPreviewResult> {
    return this.prisma.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return this.previewSnapshot(input, tx);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async previewSnapshot(
    input: TransferPreviewInput,
    db: Tx,
  ): Promise<TransferPreviewResult> {
    const { organizationId, residentId, destinationBedId, effectiveAt } = input;
    const effectiveTime = effectiveAt ?? new Date();

    // Validate UUIDs
    requireUuid(residentId, 'residentId');
    requireUuid(destinationBedId, 'destinationBedId');

    // Future-dated transfers are not allowed (D2 pending)
    if (!Number.isFinite(effectiveTime.getTime()) || effectiveTime > new Date()) {
      throw new BadRequestException(
        'Future-dated transfers are not permitted (D2 pending owner decision)',
      );
    }

    // Load resident and verify organization membership
    const resident = await db.resident.findFirst({
      where: { id: residentId, organizationId },
      select: { id: true, organizationId: true, status: true },
    });

    if (!resident) {
      throw new NotFoundException('Resident not found in this organization');
    }

    if (resident.status !== 'ACTIVE') {
      throw new ConflictException('Only an active resident can be previewed for transfer');
    }

    // Load active check-in for this resident
    const activeCheckIns = await db.checkIn.findMany({
      where: {
        residentId,
        organizationId,
        status: 'ACTIVE',
        checkOut: null,
      },
      take: 2,
      include: {
        admission: true,
        booking: {
          include: {
            bed: {
              include: {
                room: {
                  include: {
                    floor: {
                      include: { property: { select: { id: true, name: true, archivedAt: true } } },
                    },
                  },
                },
              },
            },
          },
        },
        bed: {
          include: {
            room: {
              include: {
                floor: {
                  include: { property: { select: { id: true, name: true, archivedAt: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!activeCheckIns.length) {
      throw new NotFoundException('Resident has no active check-in');
    }

    if (activeCheckIns.length > 1) {
      throw new ConflictException('Multiple active check-ins found for resident (stale state)');
    }

    const activeCheckIn = activeCheckIns[0]!;

    // Load the active stay assignment for this booking
    const activeStayAssignment = await db.effectiveStayAssignment.findFirst({
      where: {
        organizationId,
        bookingId: activeCheckIn.bookingId,
        residentId,
        status: 'ACTIVE',
        endAt: null,
      },
    });

    if (!activeStayAssignment) {
      throw new ConflictException('No active stay assignment found for this booking (stale state)');
    }

    // Check for duplicate active assignments (should not happen due to exclusion constraint)
    const duplicateActive = await db.effectiveStayAssignment.count({
      where: {
        organizationId,
        bookingId: activeCheckIn.bookingId,
        status: 'ACTIVE',
      },
    });

    if (duplicateActive > 1) {
      throw new ConflictException('Multiple active stay assignments found (stale state)');
    }

    if (
      effectiveTime < activeStayAssignment.startAt ||
      effectiveTime < activeCheckIn.checkInAt ||
      effectiveTime < istStartOfDay(activeCheckIn.booking.startDate) ||
      effectiveTime >= istStartOfDay(activeCheckIn.booking.endDate)
    ) {
      throw new ConflictException(
        'Effective time is outside the current assignment and booking interval',
      );
    }
    const sourceBed = await db.bed.findFirst({
      where: { id: activeStayAssignment.bedId, organizationId },
      include: { room: { include: { floor: { include: { property: true } } } } },
    });
    if (!sourceBed) throw new ConflictException('Current assignment bed is missing');
    if (sourceBed.id === destinationBedId)
      throw new ConflictException('Destination is the current bed');

    // Load destination bed with full hierarchy
    const destinationBed = await db.bed.findFirst({
      where: { id: destinationBedId, organizationId },
      include: {
        room: {
          include: {
            floor: {
              include: { property: { select: { id: true, name: true, archivedAt: true } } },
            },
          },
        },
      },
    });

    if (!destinationBed) {
      throw new NotFoundException('Destination bed not found in this organization');
    }

    // Verify same organization (enforced by query above)
    // Verify destination bed is in service
    if (destinationBed.operationalStatus !== 'IN_SERVICE') {
      throw new ConflictException(
        `Destination bed is ${destinationBed.operationalStatus.toLowerCase()}`,
      );
    }

    // Verify destination bed is not archived
    if (
      destinationBed.archivedAt ||
      destinationBed.room.archivedAt ||
      destinationBed.room.floor.archivedAt ||
      destinationBed.room.floor.property.archivedAt
    ) {
      throw new ConflictException('Destination bed, room, or property is archived');
    }

    // Determine transfer type
    const sourceRoomId = sourceBed.roomId;
    const destinationRoomId = destinationBed.roomId;
    const transferType = sourceRoomId === destinationRoomId ? 'BED_TRANSFER' : 'ROOM_TRANSFER';

    // Cross-property transfer check (D3 pending)
    const sourcePropertyId = sourceBed.room.floor.property.id;
    const destinationPropertyId = destinationBed.room.floor.property.id;

    // Check destination bed availability for the remaining booking period
    const bookingEndDate = istStartOfDay(activeCheckIn.booking.endDate);
    const conflicts = await this.checkDestinationAvailability(
      organizationId,
      destinationBedId,
      effectiveTime,
      bookingEndDate,
      db,
    );

    // Check for stale state
    let staleState: string | null = null;
    if (activeCheckIn.booking.status !== 'CONFIRMED') {
      staleState = 'BOOKING_NOT_CONFIRMED';
    } else if (!activeCheckIn.admission || activeCheckIn.admission.status !== 'ADMITTED') {
      staleState = 'ADMISSION_NOT_ADMITTED';
    } else if (activeCheckIn.checkInAt > effectiveTime) {
      staleState = 'CHECK_IN_AFTER_EFFECTIVE_TIME';
    }

    // Collect unresolved owner decisions (D1-D8)
    const unresolvedDecisions: string[] = [];

    // D1: Backdated transfers - check if effectiveAt is before now
    if (effectiveAt !== undefined) {
      unresolvedDecisions.push('D1: Explicit effective time policy awaits owner decision');
    }

    // D2: Future-dated transfers (already blocked above)
    // D3: Cross-property transfers (already blocked above)
    // D4: Overstay/overdue residents
    const isOverstay = activeCheckIn.booking.endDate < new Date();
    if (isOverstay) {
      unresolvedDecisions.push('D4: Overstay policy awaits owner decision');
    }

    // D5: Destination price differs (Bed.price is reference only, but we can check)
    const sourceBedPrice = sourceBed.price;
    const destBedPrice = destinationBed.price;
    if (!sourceBedPrice.equals(destBedPrice)) {
      unresolvedDecisions.push(
        'D5: Destination bed has different reference price; rent review may be required',
      );
    }

    if (sourcePropertyId !== destinationPropertyId)
      unresolvedDecisions.push('D3: Cross-property policy awaits owner decision');
    if (activeCheckIn.booking.paymentStatus === 'OVERDUE')
      unresolvedDecisions.push('D4: Overdue resident policy awaits owner decision');

    // D6: Resident confirmation required
    unresolvedDecisions.push('D6: Resident confirmation workflow not implemented');

    // D7: Transfer history vs booking history
    // D8: Partial transfers

    // Build response
    const currentAssignment: CurrentAssignmentInfo = {
      stayAssignmentId: activeStayAssignment.id,
      bedId: sourceBed.id,
      bedLabel: sourceBed.label,
      roomId: sourceBed.room.id,
      roomLabel: sourceBed.room.label,
      propertyId: sourceBed.room.floor.property.id,
      propertyName: sourceBed.room.floor.property.name,
      startAt: activeStayAssignment.startAt,
      endAt: activeStayAssignment.endAt,
    };

    const destination: DestinationBedInfo = {
      bedId: destinationBed.id,
      bedLabel: destinationBed.label,
      roomId: destinationBed.room.id,
      roomLabel: destinationBed.room.label,
      propertyId: destinationBed.room.floor.property.id,
      propertyName: destinationBed.room.floor.property.name,
      operationalStatus: destinationBed.operationalStatus,
    };

    const booking: BookingInfo = {
      id: activeCheckIn.booking.id,
      monthlyPrice: activeCheckIn.booking.monthlyPrice,
      startDate: activeCheckIn.booking.startDate,
      endDate: activeCheckIn.booking.endDate,
    };

    return {
      advisory: true,
      executionEnabled: false,
      allowedActions: ['preview'],
      executionBlockers: [
        'REQUESTER_REVIEWER_CONTRACT',
        'ASSIGNMENT_CONSUMER_ROLLOUT',
        'TRANSFER_FINANCE_LINK_CONTRACT',
        'OWNER_POLICY_AND_BACKFILL_APPROVAL',
      ],
      effectiveAt: effectiveTime,
      finance: transferFinancePreview({
        effectiveAt: effectiveTime,
        monthlyPrice: activeCheckIn.booking.monthlyPrice,
        sourcePrice: sourceBedPrice,
        destinationPrice: destBedPrice,
      }),
      available: conflicts.length === 0 && staleState === null,
      conflicts,
      currentAssignment,
      destination,
      transferType,
      booking,
      staleState,
      unresolvedDecisions,
    };
  }

  /**
   * Check if destination bed has any active check-ins overlapping the transfer period.
   * The transfer period is [effectiveAt, bookingEndDate).
   */
  private async checkDestinationAvailability(
    organizationId: string,
    destinationBedId: string,
    effectiveAt: Date,
    bookingEndDate: Date,
    db: Tx,
  ): Promise<ConflictInfo[]> {
    // Find any ACTIVE check-ins on the destination bed that overlap with [effectiveAt, bookingEndDate)
    const overlappingCheckIns = await db.checkIn.findMany({
      where: {
        organizationId,
        bedId: destinationBedId,
        status: 'ACTIVE',
        booking: { stayAssignments: { none: {} } },
        checkInAt: { lt: bookingEndDate }, // check-in started before booking ends
      },
      include: {
        checkOut: { select: { checkOutAt: true } },
      },
    });

    const conflicts: ConflictInfo[] = [];
    for (const checkIn of overlappingCheckIns) {
      const checkOutAt = checkIn.checkOut?.checkOutAt ?? null;
      // If there's a check-out, it must be after effectiveAt to overlap
      if (checkOutAt === null || checkOutAt > effectiveAt) {
        conflicts.push({
          bedId: checkIn.bedId,
          checkInId: checkIn.id,
          checkInAt: checkIn.checkInAt,
          checkOutAt,
        });
      }
    }

    const segments = await db.effectiveStayAssignment.findMany({
      where: {
        organizationId,
        bedId: destinationBedId,
        startAt: { lt: bookingEndDate },
        OR: [{ endAt: null }, { endAt: { gt: effectiveAt } }],
      },
    });
    conflicts.push(
      ...segments.map((segment) => ({
        bedId: destinationBedId,
        assignmentId: segment.id,
        checkInAt: segment.startAt,
        checkOutAt: segment.endAt,
      })),
    );
    const reservations = await db.booking.findMany({
      where: {
        organizationId,
        bedId: destinationBedId,
        status: 'CONFIRMED',
        // Booking dates are calendar values stored at UTC midnight; occupancy uses IST instants.
        startDate: { lt: new Date(bookingEndDate.getTime() + IST_OFFSET_MS) },
        endDate: { gt: new Date(effectiveAt.getTime() + IST_OFFSET_MS) },
      },
    });
    conflicts.push(
      ...reservations.map((booking) => ({
        bedId: destinationBedId,
        bookingId: booking.id,
        checkInAt: istStartOfDay(booking.startDate),
        checkOutAt: istStartOfDay(booking.endDate),
      })),
    );
    return conflicts;
  }

  async history(organizationId: string, query: Record<string, unknown>) {
    for (const key of Object.keys(query)) {
      if (!['residentId', 'page', 'limit'].includes(key))
        throw new BadRequestException({ code: 'UNKNOWN_FIELD' });
    }
    const residentId = requireUuid(query.residentId, 'residentId');
    const { page, limit } = parsePagination(query.page, query.limit);
    return this.prisma.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        if (
          !(await tx.resident.findFirst({
            where: { id: residentId, organizationId },
            select: { id: true },
          }))
        ) {
          throw new NotFoundException({ code: 'NOT_FOUND' });
        }
        const where = { organizationId, residentId };
        const total = await tx.transfer.count({ where });
        const rows = await tx.transfer.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          include: {
            actor: { select: { id: true, displayName: true } },
            financeReviews: { include: { resolution: true } },
            sourceBed: {
              include: {
                room: { include: { floor: { include: { property: { select: { name: true } } } } } },
              },
            },
            destBed: {
              include: {
                room: { include: { floor: { include: { property: { select: { name: true } } } } } },
              },
            },
          },
        });
        const describe = (bed: (typeof rows)[number]['sourceBed']) => ({
          bedLabel: bed.label,
          roomLabel: bed.room.label,
          propertyName: bed.room.floor.property.name,
        });
        return {
          items: rows.map((row) => ({
            id: row.id,
            type: row.type,
            sourceBedId: row.sourceBedId,
            destinationBedId: row.destinationBedId,
            reason: row.reason,
            effectiveAt: row.effectiveAt,
            recordedAt: row.recordedAt,
            actor: row.actor,
            financeReviews: row.financeReviews.map((review) => ({
              id: review.id,
              periodStart: review.periodStart.toISOString().slice(0, 10),
              status: review.resolution?.outcome ?? 'REVIEW_REQUIRED',
            })),
            source: describe(row.sourceBed),
            destination: describe(row.destBed),
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

  /** No effects are permitted until the specification's receipt, review and rollout prerequisites exist. */
  async execute(input: {
    organizationId: string;
    actorUserId: string;
    actorRole: string;
    residentId: string;
    destinationBedId: string;
    reason: string;
    effectiveAt: Date;
    idempotencyKey: string;
  }) {
    if (!['OWNER', 'PROPERTY_MANAGER'].includes(input.actorRole)) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
    }
    for (const field of ['residentId', 'destinationBedId', 'idempotencyKey'] as const)
      requireUuid(input[field], field);
    if (
      !input.reason.trim() ||
      input.reason.trim().length > 2000 ||
      !Number.isFinite(input.effectiveAt.getTime())
    ) {
      throw new BadRequestException({ code: 'INVALID_VALUE' });
    }
    if (input.effectiveAt > new Date())
      throw new BadRequestException({
        code: 'INVALID_VALUE',
        message: 'Future transfers are unsupported',
      });
    if (this.execution) return this.execution.execute(input);
    throw new ServiceUnavailableException({
      code: 'TRANSFER_EXECUTION_UNAVAILABLE',
      blockers: ['REQUESTER_REVIEWER_CONTRACT', 'ASSIGNMENT_CONSUMER_ROLLOUT'],
    });
  }
}
