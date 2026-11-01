import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
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
    return this.updateScoped(
      () =>
        this.prisma.db.property.updateMany({
          where: { id: propertyId, organizationId, archivedAt: null },
          data: { archivedAt: new Date() },
        }),
      () =>
        this.prisma.db.property.findFirst({
          where: { id: propertyId, organizationId },
        }),
    );
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
    return this.updateScoped(
      () =>
        this.prisma.db.floor.updateMany({
          where: { id: floorId, organizationId, archivedAt: null },
          data: { archivedAt: new Date() },
        }),
      () =>
        this.prisma.db.floor.findFirst({
          where: { id: floorId, organizationId },
        }),
    );
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
    return this.updateScoped(
      () =>
        this.prisma.db.room.updateMany({
          where: { id: roomId, organizationId, archivedAt: null },
          data: { archivedAt: new Date() },
        }),
      () =>
        this.prisma.db.room.findFirst({
          where: { id: roomId, organizationId },
        }),
    );
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

  archiveBed(organizationId: string, bedId: string) {
    return this.updateScoped(
      () =>
        this.prisma.db.bed.updateMany({
          where: { id: bedId, organizationId, archivedAt: null },
          data: { archivedAt: new Date() },
        }),
      () =>
        this.prisma.db.bed.findFirst({
          where: { id: bedId, organizationId },
        }),
    );
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
}
