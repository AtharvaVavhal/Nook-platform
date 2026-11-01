import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/client.js';

@Injectable()
export class CheckInService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: any) {
    // Verify admission exists, is ADMITTED, belongs to org, and has no active check-in
    const admission = await this.prisma.db.admission.findFirst({
      where: { id: dto.admissionId, organizationId, status: 'ADMITTED' },
      include: { booking: true, resident: true, bed: true },
    });
    if (!admission) throw new NotFoundException('Admitted admission not found');
    const existingCheckIn = await this.prisma.db.checkIn.findFirst({
      where: { admissionId: dto.admissionId, status: 'ACTIVE' },
    });
    if (existingCheckIn) throw new ConflictException('Admission already has an active check-in');

    const data: any = {
      checkInAt: new Date(dto.checkInAt),
      notes: dto.notes ?? null,
      status: 'ACTIVE',
      organization: { connect: { id: organizationId } },
      admission: { connect: { id: dto.admissionId } },
      resident: { connect: { id: dto.residentId } },
      bed: { connect: { id: dto.bedId } },
      booking: { connect: { id: dto.bookingId } },
    };
    return this.prisma.db.$transaction(async (tx) => {
      const checkIn = await tx.checkIn.create({ data });
      return checkIn;
    });
  }

  async findAll(organizationId: string, query: any) {
    const { search, status, residentId, bedId, fromDate, toDate, page = 1, limit = 20 } = query;
    const where: any = { organizationId };
    if (status) where.status = status;
    if (residentId) where.residentId = residentId;
    if (bedId) where.bedId = bedId;
    if (fromDate || toDate) {
      where.checkInAt = {};
      if (fromDate) where.checkInAt.gte = new Date(fromDate);
      if (toDate) where.checkInAt.lte = new Date(toDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.db.checkIn.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { checkInAt: 'desc' },
        include: { resident: true, bed: { include: { room: true } }, booking: true },
      }),
      this.prisma.db.checkIn.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(organizationId: string, id: string) {
    const checkIn = await this.prisma.db.checkIn.findFirst({
      where: { id, organizationId },
      include: { resident: true, bed: { include: { room: true } }, booking: true },
    });
    if (!checkIn) throw new NotFoundException('Check-in not found');
    return checkIn;
  }

  async update(organizationId: string, id: string, dto: any) {
    await this.findOne(organizationId, id);
    const data: any = {};
    if (dto.checkInAt !== undefined) data.checkInAt = new Date(dto.checkInAt);
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.db.checkIn.update({ where: { id }, data });
  }

  async cancel(organizationId: string, id: string) {
    return this.update(organizationId, id, { status: 'CHECKED_OUT' });
  }

  async checkOut(organizationId: string, checkInId: string, dto: any) {
    const checkIn = await this.prisma.db.checkIn.findFirst({
      where: { id: checkInId, organizationId, status: 'ACTIVE' },
    });
    if (!checkIn) throw new NotFoundException('Active check-in not found');
    if (checkIn.status === 'CHECKED_OUT') throw new ConflictException('Already checked out');

    const data: any = {
      checkOutAt: new Date(dto.checkOutAt),
      reason: dto.reason ?? null,
      notes: dto.notes ?? null,
      checkIn: { connect: { id: checkInId } },
      resident: { connect: { id: dto.residentId } },
      bed: { connect: { id: dto.bedId } },
      booking: { connect: { id: dto.bookingId } },
    };
    return this.prisma.db.$transaction(async (tx) => {
      const checkOut = await tx.checkOut.create({ data });
      await tx.checkIn.update({ where: { id: checkInId }, data: { status: 'CHECKED_OUT' } });
      return checkOut;
    });
  }
}