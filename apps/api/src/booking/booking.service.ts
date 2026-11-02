import { Inject, Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { parsePagination } from '../common/ids.js';
import { CreateBookingDto, UpdateBookingDto, BookingQueryDto } from './booking.dto.js';
import { Prisma } from '../generated/client.js';

@Injectable()
export class BookingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateBookingDto) {
    return this.prisma.db.$transaction(async (tx) => {
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

      // check overlapping confirmed bookings
      const overlap = await tx.booking.findFirst({
        where: {
          bedId: dto.bedId,
          status: { not: 'CANCELLED' },
          AND: [
            { startDate: { lt: new Date(dto.endDate) } },
            { endDate: { gt: new Date(dto.startDate) } },
          ],
        },
      });
      if (overlap) {
        throw new ConflictException('Bed already booked for the requested period');
      }

      const data: Prisma.BookingCreateInput = {
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        monthlyPrice: dto.monthlyPrice,
        notes: dto.notes ?? null,
        status: 'CONFIRMED',
        paymentStatus: 'PENDING',
        organization: { connect: { id: organizationId } },
        resident: { connect: { id: dto.residentId } },
        bed: { connect: { id: dto.bedId } },
      };
      return tx.booking.create({ data });
    });
  }

  async findAll(organizationId: string, query: any) {
    const { search, status, paymentStatus, residentId, bedId, fromDate, toDate, page: rawPage, limit: rawLimit } = query;
    const { page, limit } = parsePagination(rawPage, rawLimit);
    const where: any = { organizationId };
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
      if (fromDate) where.startDate.gte = new Date(fromDate);
      if (toDate) where.startDate.lte = new Date(toDate);
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
    return booking;
  }

  async update(organizationId: string, id: string, dto: any) {
    await this.findOne(organizationId, id);
    const data: any = {};
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.monthlyPrice !== undefined) data.monthlyPrice = dto.monthlyPrice;
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.paymentStatus !== undefined) data.paymentStatus = dto.paymentStatus;

    // if dates changed, re-validate overlap
    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      const existing = await this.prisma.db.booking.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Booking not found');
      const start = dto.startDate ? new Date(dto.startDate) : existing.startDate;
      const end = dto.endDate ? new Date(dto.endDate) : existing.endDate;
      const overlap = await this.prisma.db.booking.findFirst({
        where: {
          bedId: existing.bedId,
          status: { not: 'CANCELLED' },
          id: { not: id },
          AND: [
            { startDate: { lt: end } },
            { endDate: { gt: start } },
          ],
        },
      });
      if (overlap) throw new ConflictException('Bed already booked for the requested period');
    }
    if (data.status === undefined || data.status === 'CONFIRMED') {
      return this.prisma.db.booking.update({ where: { id }, data });
    }
    // Cancelling a booking whose resident is checked in would leave an active stay on a cancelled
    // booking. The row lock serialises this with a concurrent check-in, which locks the same row.
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      const active = await tx.checkIn.findFirst({
        where: { bookingId: id, organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (active) {
        throw new ConflictException(
          'This booking has an active check-in. Check the resident out before cancelling it.',
        );
      }
      return tx.booking.update({ where: { id }, data });
    });
  }

  async cancel(organizationId: string, id: string) {
    return this.update(organizationId, id, { status: 'CANCELLED' });
  }

  async getAvailableBeds(organizationId: string, startDate: Date, endDate: Date, propertyId?: string) {
    const whereBed: any = {
      organizationId,
      operationalStatus: 'IN_SERVICE',
      archivedAt: null,
      room: { archivedAt: null },
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
          select: { bedId: true },
        })
      ).map((row) => row.bedId),
    );
    const available = [];
    for (const bed of beds) {
      if (occupied.has(bed.id)) continue;
      const overlap = await this.prisma.db.booking.findFirst({
        where: {
          bedId: bed.id,
          status: { not: 'CANCELLED' },
          AND: [
            { startDate: { lt: endDate } },
            { endDate: { gt: startDate } },
          ],
        },
      });
      if (!overlap) available.push(bed);
    }
    return available;
  }
}