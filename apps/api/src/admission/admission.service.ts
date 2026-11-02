import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AdmissionStatus } from '../generated/enums.js';
import { assertMatchesParent, optionalUuid, requireUuid, parsePagination } from '../common/ids.js';
import { Prisma } from '../generated/client.js';

@Injectable()
export class AdmissionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Validates a property/room pair against the caller's organization and returns the effective pair.
   * Unknown and cross-tenant ids both give 404; a room outside the selected property gives 400; a room
   * alone derives its property. Used by create and update so both enforce the same rule.
   */
  private async resolveLocation(
    organizationId: string,
    requestedProperty: string | null,
    requestedRoom: string | null,
  ): Promise<{ propertyId: string | null; roomId: string | null }> {
    let propertyId = requestedProperty;
    if (requestedRoom) {
      const room = await this.prisma.db.room.findFirst({
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
      const property = await this.prisma.db.property.findFirst({
        where: { id: propertyId, organizationId },
        select: { id: true },
      });
      if (!property) throw new NotFoundException('Property not found');
    }
    return { propertyId, roomId: requestedRoom };
  }

  async create(organizationId: string, dto: any) {
    const bookingId = requireUuid(dto.bookingId, 'bookingId');
    const requestedProperty = optionalUuid(dto.propertyId, 'propertyId');
    const requestedRoom = optionalUuid(dto.roomId, 'roomId');
    // Verify booking exists, is CONFIRMED, belongs to org, and has no admission yet
    const booking = await this.prisma.db.booking.findFirst({
      where: { id: bookingId, organizationId, status: 'CONFIRMED' },
      include: { resident: true, bed: true },
    });
    if (!booking) throw new NotFoundException('Confirmed booking not found');
    const existingAdmission = await this.prisma.db.admission.findFirst({
      where: { bookingId },
    });
    if (existingAdmission) throw new ConflictException('Booking already has an admission');
    if (booking.status !== 'CONFIRMED')
      throw new BadRequestException('Only confirmed bookings can be admitted');

    // The booking is authoritative for who and which bed; the request may only repeat it.
    assertMatchesParent(dto.residentId, booking.residentId, 'residentId', 'booking');
    assertMatchesParent(dto.bedId, booking.bedId, 'bedId', 'booking');

    // Property and room must belong to the caller's organization (never to a client-supplied one),
    // and the room to the selected property. Unknown and cross-tenant ids are indistinguishable.
    const { propertyId, roomId: requestedRoomId } = await this.resolveLocation(
      organizationId,
      requestedProperty,
      requestedRoom,
    );

    const data: any = {
      admissionDate: new Date(dto.admissionDate),
      notes: dto.notes ?? null,
      status: 'PENDING',
      organization: { connect: { id: organizationId } },
      booking: { connect: { id: bookingId } },
      resident: { connect: { id: booking.residentId } },
      bed: { connect: { id: booking.bedId } },
    };
    if (propertyId) {
      data.property = { connect: { id: propertyId } };
    }
    if (requestedRoomId) {
      data.room = { connect: { id: requestedRoomId } };
    }

    return this.prisma.db.$transaction(async (tx) => {
      const admission = await tx.admission.create({ data });
      return admission;
    });
  }

  async findAll(organizationId: string, query: any) {
    const {
      search,
      status,
      residentId,
      bookingId,
      fromDate,
      toDate,
      page: rawPage,
      limit: rawLimit,
    } = query;
    const { page, limit } = parsePagination(rawPage, rawLimit);
    const where: any = { organizationId };
    if (status) where.status = status;
    if (residentId) where.residentId = residentId;
    if (bookingId) where.bookingId = bookingId;
    if (fromDate || toDate) {
      where.admissionDate = {};
      if (fromDate) where.admissionDate.gte = new Date(fromDate);
      if (toDate) where.admissionDate.lte = new Date(toDate);
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

  async update(organizationId: string, id: string, dto: any) {
    const existing = await this.findOne(organizationId, id);
    // Who and which bed are fixed by the booking: an update may repeat them but never change them.
    assertMatchesParent(dto.residentId, existing.residentId, 'residentId', 'admission');
    assertMatchesParent(dto.bedId, existing.bedId, 'bedId', 'admission');
    assertMatchesParent(dto.bookingId, existing.bookingId, 'bookingId', 'admission');

    const data: any = {};
    if (dto.admissionDate !== undefined) {
      const date = new Date(dto.admissionDate);
      if (Number.isNaN(date.getTime()))
        throw new BadRequestException('admissionDate must be a valid date');
      data.admissionDate = date;
    }
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;
    if (dto.status !== undefined) {
      if (!Object.values(AdmissionStatus).includes(dto.status)) {
        throw new BadRequestException(
          `status must be one of ${Object.values(AdmissionStatus).join(', ')}`,
        );
      }
      data.status = dto.status;
    }

    // Location changes get exactly the validation create gets: same organization, room within property.
    if (dto.propertyId !== undefined || dto.roomId !== undefined) {
      const roomTouched = dto.roomId !== undefined;
      const requestedRoom = roomTouched ? optionalUuid(dto.roomId, 'roomId') : existing.roomId;
      const requestedProperty =
        dto.propertyId !== undefined
          ? optionalUuid(dto.propertyId, 'propertyId')
          : roomTouched
            ? null // a new room decides its own property
            : existing.propertyId;
      const location = await this.resolveLocation(organizationId, requestedProperty, requestedRoom);
      data.property = location.propertyId
        ? { connect: { id: location.propertyId } }
        : { disconnect: true };
      data.room = location.roomId ? { connect: { id: location.roomId } } : { disconnect: true };
    }
    if (data.status === undefined || data.status === 'ADMITTED') {
      return this.prisma.db.admission.update({ where: { id }, data });
    }
    // Leaving ADMITTED (cancelling, or back to pending) while the resident is checked in would leave
    // an active stay on an admission that no longer allows one. The row lock serialises this with a
    // concurrent check-in (which locks the same row): either the check-in lands first and this is
    // refused, or this lands first and the check-in is refused.
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admissions WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      const active = await tx.checkIn.findFirst({
        where: { admissionId: id, organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (active) {
        throw new ConflictException(
          'This admission has an active check-in. Check the resident out before changing its status.',
        );
      }
      return tx.admission.update({ where: { id }, data });
    });
  }

  async cancel(organizationId: string, id: string) {
    return this.update(organizationId, id, { status: 'CANCELLED' });
  }
}
