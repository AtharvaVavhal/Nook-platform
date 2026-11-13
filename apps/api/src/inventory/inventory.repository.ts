import { activeBedOccupancyWhere } from '../common/stay-occupancy.js';
import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/client.js';
import { acquireOrgGate, ORDINARY_TX_OPTIONS } from '../common/org-gate.js';
import type { InventoryRepository } from './inventory.types.js';

export const INVENTORY_REPOSITORY = Symbol('INVENTORY_REPOSITORY');

@Injectable()
export class PrismaInventoryRepository implements InventoryRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listProperties(organizationId: string) {
    return this.prisma.db.property.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  getProperty(organizationId: string, propertyId: string) {
    return this.prisma.db.property.findFirst({
      where: { id: propertyId, organizationId, archivedAt: null },
    });
  }

  createProperty(organizationId: string, input: { code: string; name: string }) {
    return this.prisma.db.property.create({
      data: { organizationId, ...input },
    });
  }

  updateProperty(
    organizationId: string,
    propertyId: string,
    input: { code?: string; name?: string },
  ) {
    return this.updateScoped(
      () =>
        this.prisma.db.property.updateMany({
          where: { id: propertyId, organizationId, archivedAt: null },
          data: input,
        }),
      () =>
        this.prisma.db.property.findFirst({
          where: { id: propertyId, organizationId, archivedAt: null },
        }),
    );
  }

  archiveProperty(organizationId: string, propertyId: string) {
    return this.changeAvailability(organizationId, { propertyId }, true, async (tx) => {
      const changed = await tx.property.updateMany({
        where: { id: propertyId, organizationId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      return changed.count
        ? tx.property.findFirst({ where: { id: propertyId, organizationId } })
        : null;
    });
  }

  async listFloors(organizationId: string, propertyId: string) {
    if (!(await this.propertyExists(organizationId, propertyId))) return null;
    return this.prisma.db.floor.findMany({
      where: { organizationId, propertyId, archivedAt: null },
      orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
    });
  }

  async createFloor(
    organizationId: string,
    propertyId: string,
    input: { label: string; ordinal: number },
  ) {
    if (!(await this.propertyExists(organizationId, propertyId))) return null;
    return this.prisma.db.floor.create({
      data: { organizationId, propertyId, ...input },
    });
  }

  updateFloor(
    organizationId: string,
    floorId: string,
    input: { label?: string; ordinal?: number },
  ) {
    return this.updateScoped(
      () =>
        this.prisma.db.floor.updateMany({
          where: { id: floorId, organizationId, archivedAt: null },
          data: input,
        }),
      () =>
        this.prisma.db.floor.findFirst({
          where: { id: floorId, organizationId, archivedAt: null },
        }),
    );
  }

  archiveFloor(organizationId: string, floorId: string) {
    return this.changeAvailability(organizationId, { room: { floorId } }, true, async (tx) => {
      const changed = await tx.floor.updateMany({
        where: { id: floorId, organizationId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      return changed.count ? tx.floor.findFirst({ where: { id: floorId, organizationId } }) : null;
    });
  }

  async listRooms(
    organizationId: string,
    propertyId: string,
    floorId: string | undefined,
    query: string | undefined,
  ) {
    if (!(await this.propertyExists(organizationId, propertyId))) return null;
    if (floorId && !(await this.floorExists(organizationId, propertyId, floorId))) {
      return null;
    }
    return this.prisma.db.room.findMany({
      where: {
        organizationId,
        propertyId,
        archivedAt: null,
        ...(floorId ? { floorId } : {}),
        ...(query ? { label: { startsWith: query, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ label: 'asc' }, { id: 'asc' }],
    });
  }

  async createRoom(
    organizationId: string,
    propertyId: string,
    input: { floorId: string; label: string },
  ) {
    if (
      !(await this.floorExists(organizationId, propertyId, input.floorId)) ||
      !(await this.propertyExists(organizationId, propertyId))
    ) {
      return null;
    }
    return this.prisma.db.room.create({
      data: { organizationId, propertyId, ...input },
    });
  }

  updateRoom(organizationId: string, roomId: string, input: { label?: string }) {
    return this.updateScoped(
      () =>
        this.prisma.db.room.updateMany({
          where: { id: roomId, organizationId, archivedAt: null },
          data: input,
        }),
      () =>
        this.prisma.db.room.findFirst({
          where: { id: roomId, organizationId, archivedAt: null },
        }),
    );
  }

  archiveRoom(organizationId: string, roomId: string) {
    return this.changeAvailability(organizationId, { roomId }, true, async (tx) => {
      const changed = await tx.room.updateMany({
        where: { id: roomId, organizationId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      return changed.count ? tx.room.findFirst({ where: { id: roomId, organizationId } }) : null;
    });
  }

  async listBeds(organizationId: string, roomId: string) {
    const room = await this.prisma.db.room.findFirst({
      where: { id: roomId, organizationId, archivedAt: null },
    });
    if (!room) return null;
    return this.prisma.db.bed.findMany({
      where: { organizationId, roomId, archivedAt: null },
      orderBy: [{ label: 'asc' }, { id: 'asc' }],
    });
  }

  async createBed(
    organizationId: string,
    roomId: string,
    input: {
      label: string;
      operationalStatus: 'IN_SERVICE' | 'OUT_OF_SERVICE';
      outOfServiceReason?: string;
    },
  ) {
    const room = await this.prisma.db.room.findFirst({
      where: { id: roomId, organizationId, archivedAt: null },
    });
    if (!room) return null;
    return this.prisma.db.bed.create({
      data: {
        organizationId,
        propertyId: room.propertyId,
        roomId,
        ...input,
      },
    });
  }

  updateBed(
    organizationId: string,
    bedId: string,
    input: {
      label?: string;
      operationalStatus?: 'IN_SERVICE' | 'OUT_OF_SERVICE';
      outOfServiceReason?: string | null;
    },
  ) {
    if (input.operationalStatus !== undefined) {
      return this.changeAvailability(organizationId, { id: bedId }, false, async (tx) => {
        const changed = await tx.bed.updateMany({
          where: { id: bedId, organizationId, archivedAt: null },
          data: input,
        });
        return changed.count
          ? tx.bed.findFirst({ where: { id: bedId, organizationId, archivedAt: null } })
          : null;
      });
    }
    return this.updateScoped(
      () =>
        this.prisma.db.bed.updateMany({
          where: { id: bedId, organizationId, archivedAt: null },
          data: input,
        }),
      () =>
        this.prisma.db.bed.findFirst({
          where: { id: bedId, organizationId, archivedAt: null },
        }),
    );
  }

  async archiveBed(organizationId: string, bedId: string) {
    return this.changeAvailability(organizationId, { id: bedId }, true, async (tx) => {
      const changed = await tx.bed.updateMany({
        where: { id: bedId, organizationId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      return changed.count ? tx.bed.findFirst({ where: { id: bedId, organizationId } }) : null;
    });
  }

  /** Availability-changing inventory writers join the lifecycle gate, then lock beds in UUID order. */
  private async changeAvailability<T>(
    organizationId: string,
    scope: Prisma.BedWhereInput,
    archive: boolean,
    change: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.db.$transaction(async (tx) => {
      await acquireOrgGate(tx, organizationId);
      const beds = await tx.bed.findMany({
        where: { AND: [{ organizationId }, scope] },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (beds.length) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM beds WHERE organization_id = ${organizationId}::uuid
          AND id IN (${Prisma.join(beds.map((bed) => Prisma.sql`${bed.id}::uuid`))}) ORDER BY id FOR UPDATE`);
      }
      if (archive && beds.length) {
        const bedId = { in: beds.map((bed) => bed.id) };
        const [assignment, legacyStay, booking, admission] = await Promise.all([
          tx.effectiveStayAssignment.count({
            where: { organizationId, bedId, status: 'ACTIVE', endAt: null },
          }),
          tx.checkIn.count({
            where: activeBedOccupancyWhere(
              organizationId,
              beds.map((bed) => bed.id),
            ),
          }),
          tx.booking.count({
            where: { organizationId, bedId, status: 'CONFIRMED', endDate: { gte: new Date() } },
          }),
          tx.admission.count({
            where: { organizationId, bedId, status: { in: ['PENDING', 'ADMITTED'] } },
          }),
        ]);
        if (assignment || legacyStay || booking || admission)
          throw new ConflictException({ code: 'BED_OCCUPIED' });
      }
      return change(tx);
    }, ORDINARY_TX_OPTIONS);
  }

  private async propertyExists(organizationId: string, propertyId: string) {
    return Boolean(
      await this.prisma.db.property.findFirst({
        where: { id: propertyId, organizationId, archivedAt: null },
        select: { id: true },
      }),
    );
  }

  private async floorExists(organizationId: string, propertyId: string, floorId: string) {
    return Boolean(
      await this.prisma.db.floor.findFirst({
        where: { id: floorId, organizationId, propertyId, archivedAt: null },
        select: { id: true },
      }),
    );
  }

  private async updateScoped<T>(
    update: () => Promise<{ count: number }>,
    read: () => Promise<T | null>,
  ): Promise<T | null> {
    const result = await update();
    return result.count === 0 ? null : read();
  }

  async getInventorySummary(organizationId: string) {
    const [properties, floors, rooms, beds, bedsInService, bedsOutOfService, bedsArchived] =
      await Promise.all([
        this.prisma.db.property.count({ where: { organizationId, archivedAt: null } }),
        this.prisma.db.floor.count({ where: { organizationId, archivedAt: null } }),
        this.prisma.db.room.count({ where: { organizationId, archivedAt: null } }),
        this.prisma.db.bed.count({ where: { organizationId, archivedAt: null } }),
        this.prisma.db.bed.count({
          where: { organizationId, archivedAt: null, operationalStatus: 'IN_SERVICE' },
        }),
        this.prisma.db.bed.count({
          where: { organizationId, archivedAt: null, operationalStatus: 'OUT_OF_SERVICE' },
        }),
        this.prisma.db.bed.count({ where: { organizationId, archivedAt: { not: null } } }),
      ]);
    return { properties, floors, rooms, beds, bedsInService, bedsOutOfService, bedsArchived };
  }
}
