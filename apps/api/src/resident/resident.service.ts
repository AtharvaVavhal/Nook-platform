import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { CreateResidentDto, UpdateResidentDto, ResidentQueryDto } from './resident.dto.js';
import type { Resident } from '../generated/client.js';

@Injectable()
export class ResidentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateResidentDto) {
    return this.prisma.db.resident.create({
      data: {
        ...dto,
        organizationId,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      },
    });
  }

  async findAll(organizationId: string, query: ResidentQueryDto) {
    const { search, status, documentVerificationStatus, page = 1, limit = 20 } = query;
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
    const data: Record<string, any> = { ...dto };
    if (dto.dateOfBirth) data.dateOfBirth = new Date(dto.dateOfBirth);
    return this.prisma.db.resident.update({
      where: { id },
      data,
    });
  }

  async delete(organizationId: string, id: string): Promise<void> {
    await this.findOne(organizationId, id);
    await this.prisma.db.resident.delete({ where: { id } });
  }
}