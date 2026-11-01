import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/client.js';

@Injectable()
export class AdmissionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: any) {
    // Verify booking exists, is CONFIRMED, belongs to org, and has no admission yet
    const booking = await this.prisma.db.booking.findFirst({
      where: { id: dto.bookingId, organizationId, status: 'CONFIRMED' },
      include: { resident: true, bed: true },
    });
    if (!booking) throw new NotFoundException('Confirmed booking not found');
    const existingAdmission = await this.prisma.db.admission.findFirst({
      where: { bookingId: dto.bookingId },
    });
    if (existingAdmission) throw new ConflictException('Booking already has an admission');
    if (booking.status !== 'CONFIRMED') throw new BadRequestException('Only confirmed bookings can be admitted');

    const data: any = {
      admissionDate: new Date(dto.admissionDate),
      notes: dto.notes ?? null,
      status: 'PENDING',
      organization: { connect: { id: organizationId } },
      booking: { connect: { id: dto.bookingId } },
      resident: { connect: { id: dto.residentId } },
      bed: { connect: { id: dto.bedId } },
    };
    if (dto.propertyId) {
      data.property = { connect: { id: dto.propertyId } };
    }
    if (dto.roomId) {
      data.room = { connect: { id: dto.roomId } };
    }

    return this.prisma.db.$transaction(async (tx) => {
      const admission = await tx.admission.create({ data });
      return admission;
    });
  }

  async findAll(organizationId: string, query: any) {
    const { search, status, residentId, bookingId, fromDate, toDate, page = 1, limit = 20 } = query;
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
    await this.findOne(organizationId, id);
    const data: any = {};
    if (dto.admissionDate !== undefined) data.admissionDate = new Date(dto.admissionDate);
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.db.admission.update({ where: { id }, data });
  }

  async cancel(organizationId: string, id: string) {
    return this.update(organizationId, id, { status: 'CANCELLED' });
  }
}