import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { pickResidentFields } from './resident.fields.js';
import { parsePagination } from '../common/ids.js';
import { asQuery, queryEnum, queryText } from '../common/input.js';
import { CreateResidentDto, UpdateResidentDto } from './resident.dto.js';
import type { Prisma } from '../generated/client.js';
import { CorrectionError } from '../corrections/corrections.rules.js';

const RESIDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
const DOCUMENT_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;

@Injectable()
export class ResidentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateResidentDto) {
    return this.prisma.db.resident.create({
      // Only allow-listed fields; the organization is always the session's.
      data: { ...pickResidentFields(dto, false), organizationId } as never,
    });
  }

  async findAll(organizationId: string, rawQuery: unknown) {
    // Filters arrive as text: an unknown status is a 400, never a database error.
    const query = asQuery(rawQuery);
    const search = queryText(query, 'search');
    const status = queryEnum(query, 'status', RESIDENT_STATUSES);
    const documentVerificationStatus = queryEnum(
      query,
      'documentVerificationStatus',
      DOCUMENT_STATUSES,
    );
    const { page: rawPage, limit: rawLimit } = query;
    const { page, limit } = parsePagination(rawPage, rawLimit);
    const where: Prisma.ResidentWhereInput = { organizationId };

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
    // firstName / lastName change only through an approved correction (specification v1.3 section 4). The whole request is
    // refused before the archive branch can partially apply it.
    if (data.firstName !== undefined || data.lastName !== undefined) {
      throw new CorrectionError(
        409,
        'CORRECTION_REQUIRED',
        'A resident name changes only through an approved correction. Use POST /corrections.',
      );
    }
    // Archiving a resident goes through the same guarded path as DELETE, however it is requested.
    if ((data as { status?: string }).status === 'ARCHIVED') {
      return this.archiveGuarded(organizationId, id, data as Record<string, unknown>);
    }
    return this.prisma.db.resident.update({
      where: { id },
      data: data as never,
    });
  }

  /**
   * "Deleting" a resident archives it. A resident is referenced by bookings, admissions, check-ins,
   * invoices and payments (all ON DELETE RESTRICT) and by converted enquiries, and the runtime database
   * role has no DELETE privilege, so a hard delete could only ever fail or, worse, drop history.
   * Archiving keeps every record and is idempotent; billing follows stays, never resident status.
   */
  async archive(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    return this.archiveGuarded(organizationId, id, {});
  }

  /**
   * Archives a resident unless they are checked in right now (409). The check runs under the resident
   * row lock: the no-op write below takes it, and check-in locks the same row (`FOR UPDATE`) before it
   * re-reads its facts, so an archive and a check-in cannot both succeed. An already archived resident
   * is left alone (idempotent), and other fields in the same request are still applied.
   */
  private async archiveGuarded(
    organizationId: string,
    id: string,
    fields: Record<string, unknown>,
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.resident.updateMany({
        where: { id, organizationId },
        data: { updatedAt: new Date() },
      });
      if (locked.count !== 1) throw new NotFoundException('Resident not found');
      const current = await tx.resident.findFirstOrThrow({ where: { id, organizationId } });
      if (current.status !== 'ARCHIVED') {
        const active = await tx.checkIn.findFirst({
          where: { residentId: id, organizationId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (active) {
          throw new ConflictException(
            'This resident is currently checked in. Check them out before archiving.',
          );
        }
      }
      return tx.resident.update({
        where: { id },
        data: { ...fields, status: 'ARCHIVED' } as never,
      });
    });
  }
}
