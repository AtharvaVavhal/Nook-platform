import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { parsePagination, requireUuid } from '../common/ids.js';
import { pickResidentFields } from '../resident/resident.fields.js';
import {
  parseConvertBody,
  parseCreateEnquiry,
  parseEnquiryQuery,
  parseFollowUp,
  parseUpdateEnquiry,
} from './enquiry.input.js';
import { Prisma } from '../generated/client.js';

@Injectable()
export class EnquiryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The preferred property must belong to the caller's organization; unknown and foreign ids look the same. */
  private async assertOwnProperty(
    organizationId: string,
    propertyId: string | null,
  ): Promise<void> {
    if (!propertyId) return;
    const property = await this.prisma.db.property.findFirst({
      where: { id: propertyId, organizationId },
      select: { id: true },
    });
    if (!property) throw new NotFoundException('Property not found');
  }

  /** An enquiry can only be assigned to an active member of the caller's own organization. */
  private async resolveAssignee(organizationId: string, value: unknown): Promise<string | null> {
    if (value === undefined || value === null || value === '') return null;
    const userId = requireUuid(value, 'assignedUserId');
    const member = await this.prisma.db.membership.findFirst({
      where: { organizationId, userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('Assignee not found');
    return userId;
  }

  async create(organizationId: string, body: unknown) {
    const dto = parseCreateEnquiry(body);
    const assignedUserId = await this.resolveAssignee(organizationId, dto.assignedUserId);
    const preferredPropertyId = dto.preferredPropertyId;
    await this.assertOwnProperty(organizationId, preferredPropertyId);
    const data: Prisma.EnquiryCreateInput = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      email: dto.email,
      preferredRoomType: dto.preferredRoomType,
      expectedMoveInDate: dto.expectedMoveInDate,
      expectedDurationOfStay: dto.expectedDurationOfStay,
      numberOfOccupants: dto.numberOfOccupants,
      source: dto.source,
      notes: dto.notes,
      status: 'NEW',
      organization: { connect: { id: organizationId } },
      assignedUserId,
    };
    if (preferredPropertyId) {
      data.property = { connect: { id: preferredPropertyId } };
    }
    return this.prisma.db.enquiry.create({ data });
  }

  async findAll(organizationId: string, rawQuery: unknown) {
    const {
      search,
      status,
      source,
      propertyId,
      fromDate,
      toDate,
      page: rawPage,
      limit: rawLimit,
    } = parseEnquiryQuery(rawQuery);
    const { page, limit } = parsePagination(rawPage, rawLimit);
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
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
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

  async update(organizationId: string, id: string, body: unknown) {
    const dto = parseUpdateEnquiry(body);
    const existing = await this.findOne(organizationId, id);
    // A converted enquiry is tied to its resident; moving it back to an open status would contradict that link.
    if (dto.status !== undefined && existing.status === 'CONVERTED') {
      throw new ConflictException('A converted enquiry cannot change status');
    }
    const preferredPropertyId = dto.preferredPropertyId;
    if (preferredPropertyId) await this.assertOwnProperty(organizationId, preferredPropertyId);
    const data: Prisma.EnquiryUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.preferredRoomType !== undefined) data.preferredRoomType = dto.preferredRoomType;
    if (dto.expectedMoveInDate !== undefined) data.expectedMoveInDate = dto.expectedMoveInDate;
    if (dto.expectedDurationOfStay !== undefined)
      data.expectedDurationOfStay = dto.expectedDurationOfStay;
    if (dto.numberOfOccupants !== undefined) data.numberOfOccupants = dto.numberOfOccupants;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.status !== undefined) data.status = dto.status;
    if (preferredPropertyId !== undefined) {
      if (preferredPropertyId) data.property = { connect: { id: preferredPropertyId } };
      else data.property = { disconnect: true };
    }
    if (dto.assignedUserId !== undefined) {
      data.assignedUserId = await this.resolveAssignee(organizationId, dto.assignedUserId);
    }
    return this.prisma.db.enquiry.update({ where: { id }, data });
  }

  async archive(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    return this.prisma.db.enquiry.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }

  async addFollowUp(organizationId: string, enquiryId: string, userId: string, body: unknown) {
    const dto = parseFollowUp(body);
    await this.findOne(organizationId, enquiryId);
    return this.prisma.db.enquiryFollowUp.create({
      data: {
        notes: dto.notes,
        followUpAt: dto.followUpAt,
        outcome: dto.outcome,
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
    requireUuid(enquiryId, 'enquiryId');
    // Optional overrides for the new resident: allow-listed fields only (no organizationId, no id).
    const body = parseConvertBody(residentData);
    const overrides = Object.keys(body).length > 0 ? pickResidentFieldsLoose(body) : {};
    return this.prisma.db.$transaction(async (tx) => {
      // Serialize concurrent conversions of the same enquiry: the second waits here, then sees it converted.
      await tx.$queryRaw`SELECT id FROM enquiries WHERE id = ${enquiryId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      const enquiry = await tx.enquiry.findFirst({
        where: { id: enquiryId, organizationId },
        include: { resident: true },
      });
      if (!enquiry) throw new NotFoundException('Enquiry not found');
      if (enquiry.residentId) throw new BadRequestException('Enquiry already converted');
      if (enquiry.status === 'CONVERTED')
        throw new BadRequestException('Enquiry already converted');

      // Create resident
      const resident = await tx.resident.create({
        data: {
          organizationId,
          firstName: enquiry.firstName,
          lastName: enquiry.lastName,
          phone: enquiry.phone,
          email: enquiry.email,
          ...overrides,
        } as never,
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

/** Conversion overrides are partial: validate whatever resident fields were sent, drop everything else. */
function pickResidentFieldsLoose(input: unknown): Record<string, unknown> {
  return pickResidentFields(input, true);
}
