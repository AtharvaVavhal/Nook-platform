import { activeBedOccupancyWhere, physicalBedId } from '../common/stay-occupancy.js';
import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  assertValidPeriod,
  parseBookingQuery,
  periodContains,
  parseCreateBooking,
  parseUpdateBooking,
} from './booking.input.js';
import { PrismaService } from '../database/prisma.service.js';
import { parsePagination } from '../common/ids.js';
import { istDateOf, todayIst } from '../common/time.js';
import { parseExtensionRequest, canApproveExtension } from './booking.extension.js';
import { assertBedBookable, findOverlappingBooking } from './booking.rules.js';
import { Prisma } from '../generated/client.js';
import { auditRequestId } from '../observability/request-context.js';
import { ORDINARY_TX_OPTIONS, acquireOrgGate } from '../common/org-gate.js';
import { CorrectionError } from '../corrections/corrections.rules.js';

@Injectable()
export class BookingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(organizationId: string, body: unknown, actorUserId?: string) {
    // Validate before touching the database: a malformed request is a 400, never a Prisma 500.
    const dto = parseCreateBooking(body);
    return this.prisma.db.$transaction(async (tx) => {
      // Organization gate first (specification v1.3 section 10.2), then the existing Bed lock.
      await acquireOrgGate(tx, organizationId);
      // Lock the bed row (inside the transaction, scoped to the organization) so concurrent
      // bookings for the same bed serialize on the overlap check below.
      const bed = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM beds WHERE id = ${dto.bedId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      if (bed.length === 0) throw new NotFoundException('Bed not found');
      const resident = await tx.resident.findFirst({
        where: { id: dto.residentId, organizationId },
        select: { id: true },
      });
      if (!resident) throw new NotFoundException('Resident not found');

      // Usability is read under the bed lock, like the overlap below, so it cannot race a check-in
      // (which takes the same lock first) or a bed being archived or taken out of service.
      const [bedFacts, activeCheckIns] = await Promise.all([
        tx.bed.findFirstOrThrow({
          where: { id: dto.bedId, organizationId },
          select: {
            archivedAt: true,
            operationalStatus: true,
            room: {
              select: {
                archivedAt: true,
                floor: { select: { archivedAt: true, property: { select: { archivedAt: true } } } },
              },
            },
          },
        }),
        tx.checkIn.count({ where: activeBedOccupancyWhere(organizationId, dto.bedId) }),
      ]);
      assertBedBookable(bedFacts, {
        hasActiveCheckIn: activeCheckIns > 0,
        start: dto.startDate,
        end: dto.endDate,
        today: todayIst(),
      });

      // check overlapping confirmed bookings
      const overlap = await findOverlappingBooking(tx, {
        organizationId,
        bedId: dto.bedId,
        start: dto.startDate,
        end: dto.endDate,
      });
      if (overlap) {
        throw new ConflictException('Bed already booked for the requested period');
      }

      const data: Prisma.BookingCreateInput = {
        startDate: dto.startDate,
        endDate: dto.endDate,
        monthlyPrice: dto.monthlyPrice,
        notes: dto.notes,
        status: 'CONFIRMED',
        paymentStatus: 'PENDING',
        organization: { connect: { id: organizationId } },
        resident: { connect: { id: dto.residentId } },
        bed: { connect: { id: dto.bedId } },
      };
      const booking = await tx.booking.create({ data });
      await tx.auditEvent.create({
        data: {
          organizationId,
          actorUserId: actorUserId ?? null,
          action: 'booking.created',
          targetType: 'booking',
          targetId: booking.id,
          requestId: auditRequestId(),
          metadata: {
            residentId: dto.residentId,
            bedId: dto.bedId,
            startDate: dto.startDate.toISOString(),
            endDate: dto.endDate.toISOString(),
            monthlyPrice: dto.monthlyPrice.toString(),
          },
        },
      });
      return booking;
    }, ORDINARY_TX_OPTIONS);
  }

  async findAll(organizationId: string, rawQuery: unknown) {
    const {
      search,
      status,
      paymentStatus,
      residentId,
      bedId,
      fromDate,
      toDate,
      page: rawPage,
      limit: rawLimit,
    } = parseBookingQuery(rawQuery);
    const { page, limit } = parsePagination(rawPage, rawLimit);
    const where: Prisma.BookingWhereInput = { organizationId };
    if (search) {
      where.OR = [
        { resident: { firstName: { contains: search, mode: 'insensitive' } } },
        { resident: { lastName: { contains: search, mode: 'insensitive' } } },
        { resident: { phone: { contains: search, mode: 'insensitive' } } },
        { resident: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (residentId) where.residentId = residentId;
    if (bedId) where.bedId = bedId;
    if (fromDate || toDate) {
      where.startDate = {};
      if (fromDate) where.startDate.gte = fromDate;
      if (toDate) where.startDate.lte = toDate;
    }

    const [items, total] = await Promise.all([
      this.prisma.db.booking.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { resident: true, bed: { include: { room: true } } },
      }),
      this.prisma.db.booking.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(organizationId: string, id: string) {
    const booking = await this.prisma.db.booking.findFirst({
      where: { id, organizationId },
      include: { resident: true, bed: { include: { room: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return { ...booking, extensions: await this.extensionHistory(organizationId, id) };
  }

  /**
   * Approved extensions, oldest first. Each is an append-only audit event written in the same
   * transaction as the end-date change, so the previous end date, the approver and the reason
   * survive the booking row being updated.
   */
  async extensionHistory(organizationId: string, bookingId: string) {
    const events = await this.prisma.db.auditEvent.findMany({
      where: {
        organizationId,
        targetType: 'booking',
        targetId: bookingId,
        action: 'booking.extended',
      },
      orderBy: { occurredAt: 'asc' },
      include: { actor: { select: { displayName: true } } },
    });
    return events.map((event) => {
      const meta = (event.metadata ?? {}) as Record<string, unknown>;
      return {
        id: event.id,
        approvedAt: event.occurredAt.toISOString(),
        approvedByUserId: event.actorUserId,
        approvedBy: event.actor?.displayName ?? null,
        previousEndDate: meta.previousEndDate ?? null,
        newEndDate: meta.newEndDate ?? null,
        reason: meta.reason ?? null,
      };
    });
  }

  /**
   * Moves a booking's end date later. This is the only way to lengthen a booking: only an approved
   * extension authorises billing beyond the original end date. OWNER and PROPERTY_MANAGER may both
   * approve. Locks are taken in the check-in order (bed, then booking) so this cannot deadlock a
   * concurrent check-in or booking, and the overlap check runs under the bed lock exactly like
   * booking creation, so an extension and a new booking for the same bed serialize.
   */
  async extend(
    context: { organizationId: string; userId: string; role: string },
    id: string,
    body: unknown,
  ) {
    if (!canApproveExtension(context.role)) {
      throw new ForbiddenException(
        'Only an owner or property manager can approve a booking extension',
      );
    }
    const { organizationId } = context;
    const request = parseExtensionRequest(body);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new NotFoundException('Booking not found');
    }
    // Unlocked read only to learn which bed to lock; every rule is re-evaluated under the locks.
    const probe = await this.prisma.db.booking.findFirst({
      where: { id, organizationId },
      select: { bedId: true },
    });
    if (!probe) throw new NotFoundException('Booking not found');

    await this.prisma.db.$transaction(async (tx) => {
      await acquireOrgGate(tx, organizationId);
      const segments = await tx.effectiveStayAssignment.findMany({
        where: { organizationId, bookingId: id },
      });
      const activeSegments = segments.filter(
        (segment) => segment.status === 'ACTIVE' && segment.endAt === null,
      );
      if (segments.length) {
        const activeStays = await tx.checkIn.count({
          where: { organizationId, bookingId: id, status: 'ACTIVE', checkOut: null },
        });
        if (activeStays > 1 || activeSegments.length !== activeStays) {
          throw new ConflictException('Active stay assignment requires review');
        }
      }
      const bedIds = [
        ...new Set([probe.bedId, ...activeSegments.map((segment) => segment.bedId)]),
      ].sort();
      for (const bedId of bedIds) {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM beds WHERE id = ${bedId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
        if (!rows.length) throw new NotFoundException('Bed not found');
      }
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM bookings WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Booking not found');

      const booking = await tx.booking.findFirstOrThrow({ where: { id, organizationId } });
      if (booking.status !== 'CONFIRMED') {
        throw new ConflictException('Only a confirmed booking can be extended');
      }
      const currentEnd = istDateOf(booking.endDate);
      if (request.newEndDate.getTime() <= currentEnd.getTime()) {
        throw new BadRequestException('newEndDate must be later than the current end date');
      }
      // Only the added slice [current end, new end) needs checking; the rest was checked when it was booked.
      for (const bedId of bedIds) {
        const overlap = await findOverlappingBooking(tx, {
          organizationId,
          bedId,
          start: booking.endDate,
          end: request.newEndDate,
          excludeBookingId: id,
        });
        if (overlap) {
          throw new ConflictException('Bed already booked for part of the extended period');
        }
      }
      const approvedAt = new Date();
      await tx.booking.update({ where: { id }, data: { endDate: request.newEndDate } });
      await tx.auditEvent.create({
        data: {
          organizationId,
          actorUserId: context.userId,
          action: 'booking.extended',
          targetType: 'booking',
          targetId: id,
          requestId: auditRequestId(),
          metadata: {
            previousEndDate: currentEnd.toISOString().slice(0, 10),
            previousEndInstant: booking.endDate.toISOString(),
            newEndDate: request.newEndDate.toISOString().slice(0, 10),
            reason: request.reason,
            approvedByUserId: context.userId,
            approvedByRole: context.role,
            approvedAt: approvedAt.toISOString(),
          },
        },
      });
    }, ORDINARY_TX_OPTIONS);
    return this.findOne(organizationId, id);
  }

  /**
   * Updates a booking. Everything that can change what a bed is committed to (dates, status) runs in one
   * transaction under the same locks `create()` and `extend()` take, in the same order (bed, then booking),
   * and every rule is re-evaluated against the row re-read under those locks. So an update, an extension and
   * a new booking for the same bed serialize and can never leave two live bookings overlapping.
   *
   * A booking's bed never changes: `bedId` is not an updatable field, so the one bed locked here is the only
   * bed involved. The unlocked probe only learns which bed to lock; if it ever disagreed with the locked
   * row the update is refused.
   */
  async update(organizationId: string, id: string, body: unknown, actorUserId?: string) {
    const dto = parseUpdateBooking(body);
    // Candidate fields can only change through an approved correction (specification v1.3 section 4). The whole request is
    // refused before any branch (status, cancellation, payment status) can partially succeed.
    if (
      dto.startDate !== undefined ||
      dto.endDate !== undefined ||
      dto.monthlyPrice !== undefined
    ) {
      throw new CorrectionError(
        409,
        'CORRECTION_REQUIRED',
        'Booking dates and monthly price change only through an approved correction. Use POST /corrections (or /bookings/:id/extend to lengthen a booking).',
      );
    }
    const probe = await this.prisma.db.booking.findFirst({
      where: { id, organizationId },
      select: { bedId: true },
    });
    if (!probe) throw new NotFoundException('Booking not found');

    return this.prisma.db.$transaction(async (tx) => {
      await acquireOrgGate(tx, organizationId);
      const bed = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM beds WHERE id = ${probe.bedId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      if (bed.length === 0) throw new NotFoundException('Bed not found');
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM bookings WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Booking not found');

      const current = await tx.booking.findFirstOrThrow({ where: { id, organizationId } });
      if (current.bedId !== probe.bedId) {
        throw new ConflictException('The booking changed while it was being updated. Try again.');
      }

      const data: Prisma.BookingUpdateInput = {};
      if (dto.startDate !== undefined) data.startDate = dto.startDate;
      if (dto.endDate !== undefined) data.endDate = dto.endDate;
      if (dto.monthlyPrice !== undefined) data.monthlyPrice = dto.monthlyPrice;
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.paymentStatus !== undefined) data.paymentStatus = dto.paymentStatus;

      // A cancelled booking has released its bed; bringing it back without the overlap check would double-book
      // the bed. A new booking (which is checked) is the only way back.
      if (dto.status === 'CONFIRMED' && current.status === 'CANCELLED') {
        throw new ConflictException(
          'A cancelled booking cannot be re-confirmed. Create a new booking.',
        );
      }

      // if dates changed, re-validate the period and the overlap, against the locked row
      let shortenedFrom: Date | null = null;
      if (dto.startDate !== undefined || dto.endDate !== undefined) {
        const start = dto.startDate ?? current.startDate;
        const end = dto.endDate ?? current.endDate;
        assertValidPeriod(start, end);
        if (
          dto.endDate !== undefined &&
          istDateOf(end).getTime() > istDateOf(current.endDate).getTime()
        ) {
          throw new BadRequestException(
            'A booking cannot be lengthened here. Use POST /bookings/:id/extend, which needs a reason and is audited.',
          );
        }
        shortenedFrom =
          dto.endDate !== undefined &&
          istDateOf(end).getTime() < istDateOf(current.endDate).getTime()
            ? current.endDate
            : null;
        const overlap = await findOverlappingBooking(tx, {
          organizationId,
          bedId: current.bedId,
          start,
          end,
          excludeBookingId: id,
        });
        if (overlap) throw new ConflictException('Bed already booked for the requested period');
        // The period must keep covering the admission date of a live admission on this booking.
        const admission = await tx.admission.findFirst({
          where: { bookingId: id, organizationId, status: { not: 'CANCELLED' } },
          select: { admissionDate: true },
        });
        if (admission && !periodContains(start, end, admission.admissionDate)) {
          throw new ConflictException(
            "The new dates would leave this booking's admission date outside the booking period. Change the admission date first.",
          );
        }
      }

      if (data.status === 'CANCELLED') {
        // A booking with any check-in on record cannot be cancelled, even after check-out: cancelling
        // would leave a stay (past or present) on a cancelled booking and erase occupied months from
        // billing history. The booking row lock serialises this with a concurrent check-in, which locks the same row.
        const stay = await tx.checkIn.findFirst({
          where: { bookingId: id, organizationId },
          select: { id: true, status: true },
        });
        if (stay) {
          throw new ConflictException(
            stay.status === 'ACTIVE'
              ? 'This booking has an active check-in. Check the resident out before cancelling it.'
              : 'This booking has check-in history and can no longer be cancelled.',
          );
        }
        await tx.booking.update({ where: { id }, data });
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: actorUserId ?? null,
            action: 'booking.cancelled',
            targetType: 'booking',
            targetId: id,
            requestId: auditRequestId(),
            metadata: {
              reason: current.notes ?? '',
            },
          },
        });
        return { ...current, status: 'CANCELLED' };
      }

      const updated = await tx.booking.update({ where: { id }, data });
      if (shortenedFrom) {
        const changedFields: string[] = [];
        const previousValues: Record<string, unknown> = {};
        const newValues: Record<string, unknown> = {};
        if (
          dto.startDate !== undefined &&
          dto.startDate.getTime() !== current.startDate.getTime()
        ) {
          changedFields.push('startDate');
          previousValues.startDate = current.startDate.toISOString();
          newValues.startDate = dto.startDate.toISOString();
        }
        if (dto.endDate !== undefined && dto.endDate.getTime() !== current.endDate.getTime()) {
          changedFields.push('endDate');
          previousValues.endDate = current.endDate.toISOString();
          newValues.endDate = dto.endDate.toISOString();
        }
        if (
          dto.monthlyPrice !== undefined &&
          dto.monthlyPrice !== current.monthlyPrice.toString()
        ) {
          changedFields.push('monthlyPrice');
          previousValues.monthlyPrice = current.monthlyPrice.toString();
          newValues.monthlyPrice = dto.monthlyPrice.toString();
        }
        if (dto.notes !== undefined && dto.notes !== current.notes) {
          changedFields.push('notes');
          previousValues.notes = current.notes ?? null;
          newValues.notes = dto.notes ?? null;
        }
        if (dto.paymentStatus !== undefined && dto.paymentStatus !== current.paymentStatus) {
          changedFields.push('paymentStatus');
          previousValues.paymentStatus = current.paymentStatus;
          newValues.paymentStatus = dto.paymentStatus;
        }
        const additionalChanges =
          changedFields.length > 0 ? { changedFields, previousValues, newValues } : undefined;
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: actorUserId ?? null,
            action: 'booking.shortened',
            targetType: 'booking',
            targetId: id,
            requestId: auditRequestId(),
            metadata: {
              previousEndInstant: shortenedFrom.toISOString(),
              newEndInstant: updated.endDate.toISOString(),
              ...(additionalChanges ? { additionalChanges } : {}),
            } as Prisma.InputJsonObject,
          },
        });
      } else if (Object.keys(data).length > 0) {
        // Ordinary update (not cancellation, not shortening)
        const changedFields: string[] = [];
        const previousValues: Record<string, unknown> = {};
        const newValues: Record<string, unknown> = {};
        if (
          dto.startDate !== undefined &&
          dto.startDate.getTime() !== current.startDate.getTime()
        ) {
          changedFields.push('startDate');
          previousValues.startDate = current.startDate.toISOString();
          newValues.startDate = dto.startDate.toISOString();
        }
        if (dto.endDate !== undefined && dto.endDate.getTime() !== current.endDate.getTime()) {
          changedFields.push('endDate');
          previousValues.endDate = current.endDate.toISOString();
          newValues.endDate = dto.endDate.toISOString();
        }
        if (
          dto.monthlyPrice !== undefined &&
          dto.monthlyPrice !== current.monthlyPrice.toString()
        ) {
          changedFields.push('monthlyPrice');
          previousValues.monthlyPrice = current.monthlyPrice.toString();
          newValues.monthlyPrice = dto.monthlyPrice.toString();
        }
        if (dto.notes !== undefined && dto.notes !== current.notes) {
          changedFields.push('notes');
          previousValues.notes = current.notes ?? null;
          newValues.notes = dto.notes ?? null;
        }
        if (dto.paymentStatus !== undefined && dto.paymentStatus !== current.paymentStatus) {
          changedFields.push('paymentStatus');
          previousValues.paymentStatus = current.paymentStatus;
          newValues.paymentStatus = dto.paymentStatus;
        }
        if (changedFields.length > 0) {
          await tx.auditEvent.create({
            data: {
              organizationId,
              actorUserId: actorUserId ?? null,
              action: 'booking.updated',
              targetType: 'booking',
              targetId: id,
              requestId: auditRequestId(),
              metadata: { changedFields, previousValues, newValues } as Prisma.InputJsonObject,
            },
          });
        }
      }
      return updated;
    }, ORDINARY_TX_OPTIONS);
  }

  async cancel(organizationId: string, id: string) {
    return this.update(organizationId, id, { status: 'CANCELLED' });
  }

  async getAvailableBeds(
    organizationId: string,
    startDate: Date,
    endDate: Date,
    propertyId?: string,
  ) {
    const whereBed: Prisma.BedWhereInput = {
      organizationId,
      operationalStatus: 'IN_SERVICE',
      archivedAt: null,
      room: { archivedAt: null, floor: { archivedAt: null, property: { archivedAt: null } } },
    };
    if (propertyId) whereBed.propertyId = propertyId;

    const beds = await this.prisma.db.bed.findMany({
      where: whereBed,
      include: { room: true },
    });

    // A bed is also unavailable while someone is checked into it, even past its booking's end date.
    const occupied = new Set(
      (
        await this.prisma.db.checkIn.findMany({
          where: { organizationId, status: 'ACTIVE' },
          select: {
            bedId: true,
            booking: {
              select: {
                effectiveAssignments: {
                  where: { organizationId },
                  select: { bedId: true, status: true, endAt: true },
                },
              },
            },
          },
        })
      ).map(physicalBedId),
    );
    const available = [];
    for (const bed of beds) {
      if (occupied.has(bed.id)) continue;
      const overlap = await findOverlappingBooking(this.prisma.db, {
        organizationId,
        bedId: bed.id,
        start: startDate,
        end: endDate,
      });
      if (!overlap) available.push(bed);
    }
    return available;
  }
}
