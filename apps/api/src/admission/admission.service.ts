import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { assertMatchesParent, parsePagination } from '../common/ids.js';
import { Prisma } from '../generated/client.js';
import { periodContains } from '../booking/booking.input.js';
import {
  parseAdmissionQuery,
  parseCreateAdmission,
  parseUpdateAdmission,
} from './admission.input.js';
import { auditRequestId } from '../observability/request-context.js';
import { ORDINARY_TX_OPTIONS, acquireOrgGate } from '../common/org-gate.js';
import { CorrectionError } from '../corrections/corrections.rules.js';

type Tx = Prisma.TransactionClient;

@Injectable()
export class AdmissionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Validates a property/room pair against the caller's organization and returns the effective pair.
   * Unknown and cross-tenant ids both give 404; a room outside the selected property gives 400; a room
   * alone derives its property. Used by create and update so both enforce the same rule.
   */
  private async resolveLocation(
    db: Pick<Tx, 'room' | 'property'>,
    organizationId: string,
    requestedProperty: string | null,
    requestedRoom: string | null,
  ): Promise<{ propertyId: string | null; roomId: string | null }> {
    let propertyId = requestedProperty;
    if (requestedRoom) {
      const room = await db.room.findFirst({
        where: { id: requestedRoom, organizationId },
        select: { id: true, propertyId: true },
      });
      if (!room) throw new NotFoundException('Room not found');
      if (propertyId && room.propertyId !== propertyId) {
        throw new BadRequestException('Room does not belong to the selected property');
      }
      propertyId = propertyId ?? room.propertyId;
    }
    if (propertyId) {
      const property = await db.property.findFirst({
        where: { id: propertyId, organizationId },
        select: { id: true },
      });
      if (!property) throw new NotFoundException('Property not found');
    }
    return { propertyId, roomId: requestedRoom };
  }

  /**
   * Creation runs entirely inside one transaction: gate, then Bed -> Resident -> Booking row locks BEFORE the insert (the
   * insert's foreign-key checks take key-share locks on the same rows, so the order must already be Bed, Resident,
   * Booking), then every read and rule on the locked rows. Nothing that decides the insert is read outside it.
   */
  async create(organizationId: string, body: unknown, actorUserId?: string) {
    const dto = parseCreateAdmission(body);
    const bookingId = dto.bookingId;
    // Unlocked probe: only learns which Bed and Resident to lock. Every rule is re-evaluated under the locks.
    const probe = await this.prisma.db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { bedId: true, residentId: true },
    });
    if (!probe) throw new NotFoundException('Confirmed booking not found');

    return this.prisma.db.$transaction(async (tx) => {
      await acquireOrgGate(tx, organizationId);
      await this.lockRows(tx, organizationId, [
        ['beds', probe.bedId],
        ['residents', probe.residentId],
        ['bookings', bookingId],
      ]);
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, organizationId, status: 'CONFIRMED' },
        include: { resident: true, bed: true },
      });
      if (!booking) throw new NotFoundException('Confirmed booking not found');
      if (booking.bedId !== probe.bedId || booking.residentId !== probe.residentId) {
        throw new ConflictException(
          'The booking changed while the admission was being created. Try again.',
        );
      }
      const existingAdmission = await tx.admission.findFirst({ where: { bookingId } });
      if (existingAdmission) throw new ConflictException('Booking already has an admission');

      // The admission date must fall inside the booked period (the end is exclusive).
      assertWithinBooking(dto.admissionDate, booking);

      // The booking is authoritative for who and which bed; the request may only repeat it.
      assertMatchesParent(dto.residentId, booking.residentId, 'residentId', 'booking');
      assertMatchesParent(dto.bedId, booking.bedId, 'bedId', 'booking');

      const { propertyId, roomId: requestedRoomId } = await this.resolveLocation(
        tx,
        organizationId,
        dto.propertyId,
        dto.roomId,
      );

      const data: Prisma.AdmissionCreateInput = {
        admissionDate: dto.admissionDate,
        notes: dto.notes,
        status: 'PENDING',
        organization: { connect: { id: organizationId } },
        booking: { connect: { id: bookingId } },
        resident: { connect: { id: booking.residentId } },
        bed: { connect: { id: booking.bedId } },
      };
      if (propertyId) data.property = { connect: { id: propertyId } };
      if (requestedRoomId) data.room = { connect: { id: requestedRoomId } };

      const admission = await tx.admission.create({ data });
      await tx.auditEvent.create({
        data: {
          organizationId,
          actorUserId: actorUserId ?? null,
          action: 'admission.created',
          targetType: 'admission',
          targetId: admission.id,
          requestId: auditRequestId(),
          metadata: {
            bookingId,
            residentId: booking.residentId,
            bedId: booking.bedId,
            admissionDate: dto.admissionDate.toISOString(),
            propertyId: propertyId ?? null,
            roomId: requestedRoomId ?? null,
          } as Prisma.InputJsonObject,
        },
      });
      return admission;
    }, ORDINARY_TX_OPTIONS);
  }

  /** Row locks in the caller's order (the closed union keeps table names out of reach of input). */
  private async lockRows(
    tx: Tx,
    organizationId: string,
    rows: ReadonlyArray<readonly ['beds' | 'residents' | 'bookings' | 'admissions', string]>,
  ): Promise<void> {
    for (const [table, id] of rows) {
      const found = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM ${table} WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE`,
        id,
        organizationId,
      );
      if (found.length === 0) throw new NotFoundException('Record not found');
    }
  }

  async findAll(organizationId: string, rawQuery: unknown) {
    const {
      status,
      residentId,
      bookingId,
      fromDate,
      toDate,
      page: rawPage,
      limit: rawLimit,
    } = parseAdmissionQuery(rawQuery);
    const { page, limit } = parsePagination(rawPage, rawLimit);
    const where: Prisma.AdmissionWhereInput = { organizationId };
    if (status) where.status = status;
    if (residentId) where.residentId = residentId;
    if (bookingId) where.bookingId = bookingId;
    if (fromDate || toDate) {
      where.admissionDate = {};
      if (fromDate) where.admissionDate.gte = fromDate;
      if (toDate) where.admissionDate.lte = toDate;
    }

    const [items, total] = await Promise.all([
      this.prisma.db.admission.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { admissionDate: 'desc' },
        include: {
          booking: true,
          resident: true,
          bed: { include: { room: { include: { floor: { include: { property: true } } } } } },
          property: true,
          room: true,
        },
      }),
      this.prisma.db.admission.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(organizationId: string, id: string) {
    const admission = await this.prisma.db.admission.findFirst({
      where: { id, organizationId },
      include: {
        booking: true,
        resident: true,
        bed: { include: { room: { include: { floor: { include: { property: true } } } } } },
        property: true,
        room: true,
      },
    });
    if (!admission) throw new NotFoundException('Admission not found');
    return admission;
  }

  async update(organizationId: string, id: string, body: unknown, actorUserId?: string) {
    const dto = parseUpdateAdmission(body);
    // The admission date changes only through an approved correction (specification v1.3 section 4). The whole request is
    // refused before a status transition bundled with it can partially succeed.
    if (dto.admissionDate !== undefined) {
      throw new CorrectionError(
        409,
        'CORRECTION_REQUIRED',
        'The admission date changes only through an approved correction. Use POST /corrections.',
      );
    }
    // Unlocked probe: only learns which rows to lock. Every rule is re-evaluated under the locks.
    const probe = await this.prisma.db.admission.findFirst({
      where: { id, organizationId },
      select: { bedId: true, residentId: true, bookingId: true },
    });
    if (!probe) throw new NotFoundException('Admission not found');

    return this.prisma.db.$transaction(async (tx) => {
      await acquireOrgGate(tx, organizationId);
      await this.lockRows(tx, organizationId, [
        ['beds', probe.bedId],
        ['residents', probe.residentId],
        ['bookings', probe.bookingId],
        ['admissions', id],
      ]);
      const existing = await tx.admission.findFirst({
        where: { id, organizationId },
        include: { booking: true },
      });
      if (!existing) throw new NotFoundException('Admission not found');
      // Who and which bed are fixed by the booking: an update may repeat them but never change them.
      assertMatchesParent(dto.residentId, existing.residentId, 'residentId', 'admission');
      assertMatchesParent(dto.bedId, existing.bedId, 'bedId', 'admission');
      assertMatchesParent(dto.bookingId, existing.bookingId, 'bookingId', 'admission');

      const data: Prisma.AdmissionUpdateInput = {};
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.status !== undefined) data.status = dto.status;

      // Location changes get exactly the validation create gets: same organization, room within property.
      if (dto.propertyId !== undefined || dto.roomId !== undefined) {
        const roomTouched = dto.roomId !== undefined;
        const requestedRoom = roomTouched ? (dto.roomId ?? null) : existing.roomId;
        const requestedProperty =
          dto.propertyId !== undefined
            ? (dto.propertyId ?? null)
            : roomTouched
              ? null // a new room decides its own property
              : existing.propertyId;
        const location = await this.resolveLocation(
          tx,
          organizationId,
          requestedProperty,
          requestedRoom,
        );
        data.property = location.propertyId
          ? { connect: { id: location.propertyId } }
          : { disconnect: true };
        data.room = location.roomId ? { connect: { id: location.roomId } } : { disconnect: true };
      }

      const hasOtherChanges =
        dto.notes !== undefined || dto.propertyId !== undefined || dto.roomId !== undefined;
      const isCancellation = data.status === 'CANCELLED';
      const isApproval = data.status === 'ADMITTED' && existing.status !== 'ADMITTED';
      const isReopen = data.status === 'PENDING' && existing.status === 'ADMITTED';

      const auditChanges = async (
        updated:
          | typeof existing
          | { notes: string | null; propertyId: string | null; roomId: string | null },
      ) => {
        const changedFields = (['notes', 'propertyId', 'roomId'] as const).filter(
          (field) => updated[field] !== existing[field],
        );
        if (!changedFields.length) return;
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: actorUserId ?? null,
            action: 'admission.updated',
            targetType: 'admission',
            targetId: id,
            requestId: auditRequestId(),
            metadata: {
              changedFields,
              previousValues: Object.fromEntries(
                changedFields.map((field) => [field, existing[field]]),
              ),
              newValues: Object.fromEntries(changedFields.map((field) => [field, updated[field]])),
            } as Prisma.InputJsonObject,
          },
        });
      };

      if (isCancellation || isReopen) {
        // Leaving ADMITTED while the resident is checked in would leave an active stay on an admission that no longer
        // allows one. Cancelling is refused once any check-in is on record (even after check-out).
        const stay = await tx.checkIn.findFirst({
          where: {
            admissionId: id,
            organizationId,
            ...(isCancellation ? {} : { status: 'ACTIVE' as const }),
          },
          select: { id: true, status: true },
        });
        if (stay) {
          throw new ConflictException(
            stay.status === 'ACTIVE'
              ? 'This admission has an active check-in. Check the resident out before changing its status.'
              : 'This admission has check-in history and can no longer be cancelled.',
          );
        }
        const updated = await tx.admission.update({ where: { id }, data });
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: actorUserId ?? null,
            action: isCancellation ? 'admission.cancelled' : 'admission.reopened',
            targetType: 'admission',
            targetId: id,
            requestId: auditRequestId(),
            metadata: {
              previousStatus: existing.status,
              ...(isCancellation
                ? {}
                : { reopenedAt: new Date().toISOString(), reopenedByUserId: actorUserId }),
            } as Prisma.InputJsonObject,
          },
        });
        await auditChanges(updated);
        return updated;
      }

      if (isApproval) {
        const updated = await tx.admission.update({ where: { id }, data });
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: actorUserId ?? null,
            action: 'admission.approved',
            targetType: 'admission',
            targetId: id,
            requestId: auditRequestId(),
            metadata: {
              previousStatus: existing.status,
              approvedByUserId: actorUserId,
              approvedAt: new Date().toISOString(),
            } as Prisma.InputJsonObject,
          },
        });
        await auditChanges(updated);
        return updated;
      }

      // No status change, or a status that is not a transition: the write and its audit are one transaction.
      const updated = await tx.admission.update({ where: { id }, data });
      if (hasOtherChanges) await auditChanges(updated);
      return updated;
    }, ORDINARY_TX_OPTIONS);
  }

  async cancel(organizationId: string, id: string, actorUserId?: string) {
    return this.update(organizationId, id, { status: 'CANCELLED' }, actorUserId);
  }
}

/** An admission date must lie inside its booking's period, compared as Asia/Kolkata calendar days. */
function assertWithinBooking(
  admissionDate: Date,
  booking: { startDate: Date; endDate: Date },
): void {
  if (!periodContains(booking.startDate, booking.endDate, admissionDate)) {
    throw new BadRequestException(
      'admissionDate must fall within the booking period (from the start date up to, not including, the end date)',
    );
  }
}
