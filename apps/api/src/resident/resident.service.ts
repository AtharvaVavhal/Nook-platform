import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { pickResidentFields } from './resident.fields.js';
import { parsePagination } from '../common/ids.js';
import { CreateResidentDto, UpdateResidentDto, ResidentQueryDto } from './resident.dto.js';
import type { Resident } from '../generated/client.js';

@Injectable()
export class ResidentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateResidentDto) {
    return this.prisma.db.resident.create({
      // Only allow-listed fields; the organization is always the session's.
      data: { ...pickResidentFields(dto, false), organizationId } as never,
    });
  }

  async findAll(organizationId: string, query: ResidentQueryDto) {
    const { search, status, documentVerificationStatus, page: rawPage, limit: rawLimit } = query;
    const { page, limit } = parsePagination(rawPage, rawLimit);
    const where: Record<string, any> = { organizationId };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (documentVerificationStatus) where.documentVerificationStatus = documentVerificationStatus;

    const [items, total] = await Promise.all([
      this.prisma.db.resident.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.resident.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(organizationId: string, id: string) {
    const resident = await this.prisma.db.resident.findFirst({
      where: { id, organizationId },
    });
    if (!resident) throw new NotFoundException('Resident not found');
    return resident;
  }

  async update(organizationId: string, id: string, dto: UpdateResidentDto) {
    await this.findOne(organizationId, id);
    // Allow-listed fields only: a body can never carry organizationId, id or timestamps into the update.
    const data = pickResidentFields(dto, true);
    return this.prisma.db.resident.update({
      where: { id },
      data: data as never,
    });
  }

  async delete(organizationId: string, id: string): Promise<void> {
    await this.findOne(organizationId, id);
    await this.prisma.db.resident.delete({ where: { id } });
  }
}
