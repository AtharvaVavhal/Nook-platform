import { OriginalAssignmentWriter } from '../common/assignment-adoption.js';
import {
  activeBedOccupancyWhere,
  physicalBedId,
  assertAssignmentTimeline,
} from '../common/stay-occupancy.js';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { assertMatchesParent, parsePagination, requireUuid } from '../common/ids.js';
import { Prisma } from '../generated/client.js';
import {
  MAX_NOTES_LENGTH,
  MAX_REASON_LENGTH,
  assertCanCheckIn,
  assertCanCheckOut,
  isOverstay,
  optionalText,
  resolveInstant,
} from './checkin.rules.js';
import { auditRequestId } from '../observability/request-context.js';
import { acquireOrgGate } from '../common/org-gate.js';
import { CorrectionError } from '../corrections/corrections.rules.js';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INCLUDE = {
  resident: true,
  bed: { include: { room: true } },
  booking: { include: { effectiveAssignments: { include: { bed: { include: { room: true } } } } } },
  admission: true,
  checkOut: true,
} satisfies Prisma.CheckInInclude;

/** Preserve the original check-in identity while exposing the reconciled physical location to readers. */
function withPhysicalBed(stay: Prisma.CheckInGetPayload<{ include: typeof INCLUDE }>) {
  assertAssignmentTimeline(stay);
  const segments = [...stay.booking.effectiveAssignments].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
  return { ...stay, physicalBed: segments.at(-1)?.bed ?? stay.bed };
}

/**
 * Check-in / check-out.
 *
 * Concurrency: the database has `UNIQUE(admission_id)` on check-ins and `UNIQUE(check_in_id)` on
 * check-outs, but nothing that stops two different admissions from being checked into one bed, and
 * nothing that stops a cancellation from slipping in between a status read and a write. Those rules
 * are enforced here with row locks (`SELECT … FOR UPDATE`) taken in one fixed order, then re-read:
 *
 *   check-in : bed → resident → booking → admission
 *   check-out: check-in
 *   cancelling an admission / booking (see AdmissionService / BookingService): that one row
 *
 * Every path takes a prefix-ordered subset of the same order, so none can deadlock another.
 *
 * KYC: INTEGRATION POINT (pending, intentionally not enforced). When a real verification module
 * exists, its "verified" decision for `admission.residentId` is checked inside `create()` below,
 * after the locks are taken and before `checkIn.create`, and a failure is thrown as a 409 with the
 * reason. `Resident.documentVerificationStatus` is deliberately NOT used as that gate: it is a
 * free-text-editable field with no verification behind it, so enforcing it would only make an
 * unverified flag look like a control. See docs/nook-phase-3/TASK_4E_CHECKIN_CHECKOUT.md.
 */
@Injectable()
export class CheckInService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(OriginalAssignmentWriter)
    private readonly assignments?: OriginalAssignmentWriter,
  ) {}

  private async lock(
    tx: Tx,
    table: 'beds' | 'residents' | 'bookings' | 'admissions' | 'check_ins',
    id: string,
    organizationId: string,
  ) {
    // Table name comes from the closed union above, never from input.
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM ${table} WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE`,
      id,
      organizationId,
    );
    return rows.length > 0;
  }

  async create(organizationId: string, dto: Record<string, unknown>, actorUserId?: string) {
    const admissionId = requireUuid(dto.admissionId, 'admissionId');
    const checkInAt = resolveInstant(dto.checkInAt, 'checkInAt');
    const notes = optionalText(dto.notes, 'notes', MAX_NOTES_LENGTH);

    // Unlocked read only to learn which rows to lock; every rule is re-evaluated under the locks.
    const probe = await this.prisma.db.admission.findFirst({
      where: { id: admissionId, organizationId },
      select: { bedId: true, residentId: true, bookingId: true },
    });
    if (!probe) throw new NotFoundException('Admission not found');

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        // Organization gate first (specification v1.3 10.2), then the existing Bed -> Resident -> Booking -> Admission locks.
        // Revalidate both active occupancy and recorded physical intervals under the lifecycle gate.
        // Assignment segments are authoritative; bookings with no assignments retain legacy interval checks.
        await acquireOrgGate(tx, organizationId);
        if (!(await this.lock(tx, 'beds', probe.bedId, organizationId)))
          throw new NotFoundException('Bed not found');
        await this.lock(tx, 'residents', probe.residentId, organizationId);
        await this.lock(tx, 'bookings', probe.bookingId, organizationId);
        if (!(await this.lock(tx, 'admissions', admissionId, organizationId))) {
          throw new NotFoundException('Admission not found');
        }

        const admission = await tx.admission.findFirst({
          where: { id: admissionId, organizationId },
        });
        if (!admission) throw new NotFoundException('Admission not found');
        // The admission is authoritative for resident, bed and booking; the request may only repeat them.
        assertMatchesParent(dto.residentId, admission.residentId, 'residentId', 'admission');
        assertMatchesParent(dto.bedId, admission.bedId, 'bedId', 'admission');
        assertMatchesParent(dto.bookingId, admission.bookingId, 'bookingId', 'admission');

        const [booking, bed, existingForAdmission, onBed, forResident] = await Promise.all([
          tx.booking.findFirstOrThrow({ where: { id: admission.bookingId, organizationId } }),
          tx.bed.findFirstOrThrow({
            where: { id: admission.bedId, organizationId },
            include: {
              room: {
                select: {
                  archivedAt: true,
                  floor: {
                    select: { archivedAt: true, property: { select: { archivedAt: true } } },
                  },
                },
              },
            },
          }),
          tx.checkIn.findFirst({
            where: { admissionId, organizationId },
            select: { status: true },
          }),
          tx.checkIn.count({ where: activeBedOccupancyWhere(organizationId, admission.bedId) }),
          tx.checkIn.count({
            where: { organizationId, residentId: admission.residentId, status: 'ACTIVE' },
          }),
        ]);

        // Read under the resident lock, so it cannot race the guarded archive in ResidentService.
        const resident = await tx.resident.findFirstOrThrow({
          where: { id: admission.residentId, organizationId },
          select: { status: true },
        });
        if (resident.status === 'ARCHIVED') {
          throw new ConflictException('This resident is archived and cannot be checked in');
        }

        assertCanCheckIn({
          admission,
          booking,
          bed,
          existingForAdmission,
          activeOnBed: onBed > 0,
          activeForResident: forResident > 0,
        });
        // A new stay is open-ended, so it overlaps any recorded stay of this bed or resident that ended after its start.
        // Corrections may move a completed stay's check-out (corrections.apply.ts); both writers hold the organization
        // gate, so whichever commits second sees the other and one of the two is refused rather than overlapping.
        const overlapping = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT s.id FROM effective_stay_assignments s
          WHERE s.organization_id = ${organizationId}::uuid
            AND (s.bed_id = ${admission.bedId}::uuid OR s.resident_id = ${admission.residentId}::uuid)
            AND COALESCE(s.end_at, 'infinity'::timestamptz) > ${checkInAt}::timestamptz
          UNION ALL
          SELECT o.id FROM check_outs o
          JOIN check_ins c ON c.id = o.check_in_id AND c.organization_id = o.organization_id
          WHERE o.organization_id = ${organizationId}::uuid
            AND (c.bed_id = ${admission.bedId}::uuid OR c.resident_id = ${admission.residentId}::uuid)
            AND NOT EXISTS (SELECT 1 FROM stay_assignments s WHERE s.organization_id = c.organization_id AND s.booking_id = c.booking_id)
            AND o.check_out_at > ${checkInAt}::timestamptz
          LIMIT 1`);
        if (overlapping.length > 0) {
          throw new ConflictException(
            'This check-in would overlap an earlier stay recorded for this bed or resident',
          );
        }
        // KYC integration point: see the class comment. Pending; nothing is checked here yet.

        const checkIn = await tx.checkIn.create({
          data: {
            checkInAt,
            notes,
            status: 'ACTIVE',
            organization: { connect: { id: organizationId } },
            admission: { connect: { id: admissionId } },
            resident: { connect: { id: admission.residentId } },
            bed: { connect: { id: admission.bedId } },
            booking: { connect: { id: admission.bookingId } },
          },
          include: INCLUDE,
        });
        await this.assignments?.mirror(tx, organizationId, checkIn.id);
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: actorUserId ?? null,
            action: 'checkin.created',
            targetType: 'check_in',
            targetId: checkIn.id,
            requestId: auditRequestId(),
            metadata: {
              admissionId,
              residentId: admission.residentId,
              bedId: admission.bedId,
              bookingId: admission.bookingId,
              checkInAt: checkInAt.toISOString(),
            } as Prisma.InputJsonObject,
          },
        });
        return checkIn;
      }, TX_OPTIONS);
    } catch (error) {
      throw this.translate(error);
    }
  }

  async findAll(organizationId: string, query: Record<string, unknown>) {
    const { page, limit } = parsePagination(query.page, query.limit);
    const where: Prisma.CheckInWhereInput = { organizationId };
    if (query.status !== undefined && query.status !== '') {
      if (query.status !== 'ACTIVE' && query.status !== 'CHECKED_OUT') {
        throw new BadRequestException('status must be one of ACTIVE, CHECKED_OUT');
      }
      where.status = query.status;
    }
    for (const field of ['residentId', 'bedId'] as const) {
      const value = query[field];
      if (value !== undefined && value !== '') where[field] = requireUuid(value, field);
    }
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    if (search) {
      where.resident = {
        is: {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }
    const range: Prisma.DateTimeFilter = {};
    if (query.fromDate) range.gte = resolveInstant(query.fromDate, 'fromDate');
    if (query.toDate) range.lte = resolveInstant(query.toDate, 'toDate');
    if (range.gte || range.lte) where.checkInAt = range;

    const [items, total] = await Promise.all([
      this.prisma.db.checkIn.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ checkInAt: 'desc' }, { id: 'asc' }],
        include: INCLUDE,
      }),
      this.prisma.db.checkIn.count({ where }),
    ]);
    return {
      items: items.map(withPhysicalBed),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Occupancy is the set of ACTIVE check-ins. Bed status alone (in service / out of service) never means occupied. */
  async occupancy(organizationId: string) {
    const active = await this.prisma.db.checkIn.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: {
        id: true,
        bedId: true,
        booking: {
          select: {
            id: true,
            endDate: true,
            effectiveAssignments: {
              where: { organizationId },
              select: { bedId: true, status: true, endAt: true },
            },
          },
        },
        resident: { select: { firstName: true, lastName: true } },
      },
    });
    const occupiedBedIds = [...new Set(active.map(physicalBedId))];
    // Residents still checked in past their booking's end date: not billed without an approved extension.
    const now = new Date();
    const overstays = active
      .filter((row) => isOverstay(row.booking.endDate, now))
      .map((row) => ({
        checkInId: row.id,
        bookingId: row.booking.id,
        bedId: physicalBedId(row),
        residentName: `${row.resident.firstName} ${row.resident.lastName}`.trim(),
        bookingEndDate: row.booking.endDate.toISOString(),
      }))
      .sort((a, b) => a.bookingEndDate.localeCompare(b.bookingEndDate));
    const totalBeds = await this.prisma.db.bed.count({
      where: { organizationId, archivedAt: null, room: { archivedAt: null } },
    });
    return {
      activeCheckIns: active.length,
      occupiedBeds: occupiedBedIds.length,
      totalBeds,
      occupiedBedIds,
      overstayCount: overstays.length,
      overstays: overstays.slice(0, 50),
    };
  }

  async findOne(organizationId: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Check-in not found');
    const checkIn = await this.prisma.db.checkIn.findFirst({
      where: { id, organizationId },
      include: INCLUDE,
    });
    if (!checkIn) throw new NotFoundException('Check-in not found');
    return withPhysicalBed(checkIn);
  }

  /**
   * Only the notes can change. Status moves only through check-out (which records who/when), and the
   * check-in time is what billing starts from, so neither is editable here: history stays intact.
   */
  async update(organizationId: string, id: string, dto: Record<string, unknown>) {
    for (const field of [
      'status',
      'checkInAt',
      'admissionId',
      'residentId',
      'bedId',
      'bookingId',
    ]) {
      if (dto[field] !== undefined) {
        throw new BadRequestException(
          field === 'status'
            ? 'Status changes only through check-out'
            : `${field} cannot be changed on an existing check-in`,
        );
      }
    }
    await this.findOne(organizationId, id);
    const data: Prisma.CheckInUpdateInput = {};
    if (dto.notes !== undefined) data.notes = optionalText(dto.notes, 'notes', MAX_NOTES_LENGTH);
    if (Object.keys(data).length > 0) {
      await this.prisma.db.$transaction(async (tx) => {
        await acquireOrgGate(tx, organizationId);
        if (!(await this.lock(tx, 'check_ins', id, organizationId))) {
          throw new NotFoundException('Check-in not found');
        }
        const current = await tx.checkIn.findFirst({
          where: { id, organizationId },
          select: { status: true, checkOut: { select: { id: true } } },
        });
        if (!current) throw new NotFoundException('Check-in not found');
        // A CHECKED_OUT check-in with no CheckOut row uses `updatedAt` as its billing end. A notes edit would move that
        // boundary, so it is refused (fail closed); no checkout is fabricated.
        if (current.status === 'CHECKED_OUT' && !current.checkOut) {
          throw new CorrectionError(
            409,
            'LIFECYCLE_CONFLICT',
            'This legacy check-in has no check-out record, so its notes cannot be edited without moving its billing boundary.',
          );
        }
        const result = await tx.checkIn.updateMany({ where: { id, organizationId }, data });
        if (result.count !== 1) throw new NotFoundException('Check-in not found');
      }, TX_OPTIONS);
    }
    return this.findOne(organizationId, id);
  }

  async checkOut(
    organizationId: string,
    checkInId: string,
    dto: Record<string, unknown>,
    actorUserId?: string,
  ) {
    requireUuid(checkInId, 'checkInId');
    const checkOutAt = resolveInstant(dto.checkOutAt, 'checkOutAt');
    const reason = optionalText(dto.reason, 'reason', MAX_REASON_LENGTH);
    const notes = optionalText(dto.notes, 'notes', MAX_NOTES_LENGTH);

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        await acquireOrgGate(tx, organizationId);
        const probe = await tx.checkIn.findFirst({ where: { id: checkInId, organizationId } });
        if (!probe) throw new NotFoundException('Check-in not found');
        const segments = await tx.effectiveStayAssignment.findMany({
          where: { organizationId, bookingId: probe.bookingId },
        });
        const activeSegments = segments.filter(
          (segment) => segment.status === 'ACTIVE' && segment.endAt === null,
        );
        if (segments.length && activeSegments.length !== 1)
          throw new ConflictException('Active stay assignment requires review');
        const assignment = activeSegments[0];
        const currentBedId = assignment?.bedId ?? probe.bedId;
        await this.lock(tx, 'beds', currentBedId, organizationId);
        await this.lock(tx, 'bookings', probe.bookingId, organizationId);
        if (!(await this.lock(tx, 'check_ins', checkInId, organizationId))) {
          throw new NotFoundException('Check-in not found');
        }
        // Re-read after the lock: a racing check-out that won has committed CHECKED_OUT by now.
        const checkIn = await tx.checkIn.findFirstOrThrow({
          where: { id: checkInId, organizationId },
        });
        assertMatchesParent(dto.residentId, checkIn.residentId, 'residentId', 'check-in');
        assertMatchesParent(dto.bedId, checkIn.bedId, 'bedId', 'check-in');
        assertMatchesParent(dto.bookingId, checkIn.bookingId, 'bookingId', 'check-in');
        assertCanCheckOut(checkIn, checkOutAt);

        if (assignment && checkOutAt <= assignment.startAt) {
          throw new ConflictException('Check-out must be after the current assignment start');
        }
        if (assignment) {
          const closed = await tx.stayAssignment.updateMany({
            where: { id: assignment.id, organizationId, status: 'ACTIVE', endAt: null },
            data: { status: 'COMPLETED', endAt: checkOutAt },
          });
          if (closed.count !== 1)
            throw new ConflictException('Current assignment changed; refresh and retry');
        }
        const checkOut = await tx.checkOut.create({
          data: {
            checkOutAt,
            reason,
            notes,
            organization: { connect: { id: organizationId } },
            checkIn: { connect: { id: checkInId } },
            resident: { connect: { id: checkIn.residentId } },
            // The lifecycle integrity trigger retains the original check-in bed on CheckOut.
            // StayAssignment records the physical destination and is closed in this transaction.
            bed: { connect: { id: checkIn.bedId } },
            booking: { connect: { id: checkIn.bookingId } },
          },
        });
        const moved = await tx.checkIn.updateMany({
          where: { id: checkInId, organizationId, status: 'ACTIVE' },
          data: { status: 'CHECKED_OUT' },
        });
        if (moved.count !== 1)
          throw new ConflictException('This check-in has already been checked out');
        // Nothing else is touched: the booking, admission and invoices are deliberately left as they are.
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: actorUserId ?? null,
            action: 'checkout.created',
            targetType: 'check_out',
            targetId: checkOut.id,
            requestId: auditRequestId(),
            metadata: {
              checkInId,
              residentId: checkIn.residentId,
              bedId: checkIn.bedId,
              physicalBedId: currentBedId,
              stayAssignmentId: assignment?.id ?? null,
              bookingId: checkIn.bookingId,
              checkOutAt: checkOutAt.toISOString(),
              reason: reason ?? null,
            } as Prisma.InputJsonObject,
          },
        });
        return checkOut;
      }, TX_OPTIONS);
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** Database-level backstops surface as clean conflicts, never 500s. */
  private translate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(
        'A concurrent request already recorded this check-in or check-out',
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return new NotFoundException('Record not found');
    }
    return error;
  }
}
