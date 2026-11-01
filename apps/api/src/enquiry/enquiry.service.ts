import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { CreateEnquiryDto, UpdateEnquiryDto, EnquiryQueryDto, CreateFollowUpDto } from './enquiry.dto.js';
import { Prisma } from '../generated/client.js';

@Injectable()
export class EnquiryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateEnquiryDto) {
    const data: Prisma.EnquiryCreateInput = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      email: dto.email ?? null,
      preferredRoomType: dto.preferredRoomType ?? null,
      expectedMoveInDate: dto.expectedMoveInDate ? new Date(dto.expectedMoveInDate) : null,
      expectedDurationOfStay: dto.expectedDurationOfStay ?? null,
      numberOfOccupants: dto.numberOfOccupants ?? null,
      source: dto.source ?? 'OTHER',
      notes: dto.notes ?? null,
      status: 'NEW',
      organization: { connect: { id: organizationId } },
      assignedUserId: dto.assignedUserId ?? null,
    };
    if (dto.preferredPropertyId) {
      data.property = { connect: { id: dto.preferredPropertyId } };
    }
    return this.prisma.db.enquiry.create({ data });
  }

  async findAll(organizationId: string, query: EnquiryQueryDto) {
    const { search, status, source, propertyId, fromDate, toDate, page = 1, limit = 20 } = query;
    const where: Prisma.EnquiryWhereInput = { organizationId };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status as any;
    if (source) where.source = source as any;
    if (propertyId) where.propertyId = propertyId;
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.db.enquiry.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { property: true, resident: true },
      }),
      this.prisma.db.enquiry.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(organizationId: string, id: string) {
    const enquiry = await this.prisma.db.enquiry.findFirst({
      where: { id, organizationId },
      include: { property: true, resident: true, followUps: { orderBy: { followUpAt: 'asc' } } },
    });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    return enquiry;
  }

  async update(organizationId: string, id: string, dto: UpdateEnquiryDto) {
    await this.findOne(organizationId, id);
    const data: Prisma.EnquiryUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.preferredRoomType !== undefined) data.preferredRoomType = dto.preferredRoomType ?? null;
    if (dto.expectedMoveInDate !== undefined) data.expectedMoveInDate = dto.expectedMoveInDate ? new Date(dto.expectedMoveInDate) : null;
    if (dto.expectedDurationOfStay !== undefined) data.expectedDurationOfStay = dto.expectedDurationOfStay ?? null;
    if (dto.numberOfOccupants !== undefined) data.numberOfOccupants = dto.numberOfOccupants ?? null;
    if (dto.source !== undefined) data.source = dto.source as any;
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;
    if (dto.status !== undefined) data.status = dto.status as any;
    if (dto.preferredPropertyId !== undefined) {
      if (dto.preferredPropertyId) data.property = { connect: { id: dto.preferredPropertyId } };
      else data.property = { disconnect: true };
    }
    if (dto.assignedUserId !== undefined) data.assignedUserId = dto.assignedUserId ?? null;
    return this.prisma.db.enquiry.update({ where: { id }, data });
  }

  async archive(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    return this.prisma.db.enquiry.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }

  async addFollowUp(organizationId: string, enquiryId: string, userId: string, dto: CreateFollowUpDto) {
    await this.findOne(organizationId, enquiryId);
    return this.prisma.db.enquiryFollowUp.create({
      data: {
        notes: dto.notes,
        followUpAt: new Date(dto.followUpAt),
        outcome: dto.outcome ?? null,
        enquiry: { connect: { id: enquiryId } },
        user: { connect: { id: userId } },
      },
    });
  }

  async getFollowUps(organizationId: string, enquiryId: string) {
    await this.findOne(organizationId, enquiryId);
    return this.prisma.db.enquiryFollowUp.findMany({
      where: { enquiryId },
      orderBy: { followUpAt: 'asc' },
      include: { user: { select: { id: true, displayName: true, loginIdentifier: true } } },
    });
  }

  async convert(organizationId: string, enquiryId: string, residentData: any) {
    return this.prisma.db.$transaction(async (tx) => {
      const enquiry = await tx.enquiry.findFirst({
        where: { id: enquiryId, organizationId },
        include: { resident: true },
      });
      if (!enquiry) throw new NotFoundException('Enquiry not found');
      if (enquiry.residentId) throw new BadRequestException('Enquiry already converted');
      if (enquiry.status === 'CONVERTED') throw new BadRequestException('Enquiry already converted');

      // Create resident
      const resident = await tx.resident.create({
        data: {
          organizationId,
          firstName: enquiry.firstName,
          lastName: enquiry.lastName,
          phone: enquiry.phone,
          email: enquiry.email,
          ...residentData,
        },
      });

      // Update enquiry
      await tx.enquiry.update({
        where: { id: enquiryId },
        data: { status: 'CONVERTED', residentId: resident.id },
      });

      return { enquiry, resident };
    });
  }

  async getOverdueFollowUps(organizationId: string) {
    const now = new Date();
    return this.prisma.db.enquiryFollowUp.findMany({
      where: {
        enquiry: { organizationId, status: { not: 'CONVERTED' } },
        followUpAt: { lt: new Date() },
        outcome: null,
      },
      include: { enquiry: true, user: { select: { id: true, displayName: true } } },
      orderBy: { followUpAt: 'asc' },
    });
  }

  async getUpcomingFollowUps(organizationId: string, days = 7) {
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return this.prisma.db.enquiryFollowUp.findMany({
      where: {
        enquiry: { organizationId, status: { not: 'CONVERTED' } },
        followUpAt: { gte: now, lte: future },
        outcome: null,
      },
      include: { enquiry: true, user: { select: { id: true, displayName: true } } },
      orderBy: { followUpAt: 'asc' },
    });
  }
}