import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/client.js';
import { INVENTORY_REPOSITORY } from './inventory.repository.js';
import type { InventoryRepository } from './inventory.types.js';
import { classifyFailure } from '../common/tx-errors.js';
import { BULK_MAX_BEDS, BULK_MAX_ROOMS, type BulkRoomInput } from './inventory.bulk.validation.js';
import type { AuthenticatedContext } from '../auth/auth.types.js';

@Injectable()
export class InventoryService {
  constructor(@Inject(INVENTORY_REPOSITORY) private readonly repository: InventoryRepository) {}

  private assertRole(context: AuthenticatedContext) {
    if (context.role !== 'OWNER' && context.role !== 'PROPERTY_MANAGER') {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
  }

  async listProperties(context: AuthenticatedContext) {
    this.assertRole(context);
    return { data: await this.repository.listProperties(context.organizationId) };
  }

  async getProperty(context: AuthenticatedContext, propertyId: string) {
    this.assertRole(context);
    const result = await this.repository.getProperty(context.organizationId, propertyId);
    if (!result) throw notFound();
    return { data: result };
  }

  async createProperty(context: AuthenticatedContext, input: { code: string; name: string }) {
    this.assertRole(context);
    return {
      data: await this.create(() => this.repository.createProperty(context.organizationId, input)),
    };
  }

  async updateProperty(
    context: AuthenticatedContext,
    propertyId: string,
    input: { code?: string; name?: string },
  ) {
    this.assertRole(context);
    const result = await this.update(() =>
      this.repository.updateProperty(context.organizationId, propertyId, input),
    );
    return { data: result };
  }

  async archiveProperty(context: AuthenticatedContext, propertyId: string) {
    this.assertRole(context);
    const result = await this.update(() =>
      this.repository.archiveProperty(context.organizationId, propertyId),
    );
    return { data: result };
  }

  async listFloors(context: AuthenticatedContext, propertyId: string) {
    this.assertRole(context);
    const result = await this.repository.listFloors(context.organizationId, propertyId);
    if (!result) throw notFound();
    return { data: result };
  }

  async createFloor(
    context: AuthenticatedContext,
    propertyId: string,
    input: { label: string; ordinal: number },
  ) {
    this.assertRole(context);
    const result = await this.createNullable(() =>
      this.repository.createFloor(context.organizationId, propertyId, input),
    );
    return { data: result };
  }

  async updateFloor(
    context: AuthenticatedContext,
    floorId: string,
    input: { label?: string; ordinal?: number },
  ) {
    this.assertRole(context);
    return {
      data: await this.update(() =>
        this.repository.updateFloor(context.organizationId, floorId, input),
      ),
    };
  }

  async archiveFloor(context: AuthenticatedContext, floorId: string) {
    this.assertRole(context);
    return {
      data: await this.update(() => this.repository.archiveFloor(context.organizationId, floorId)),
    };
  }

  async listRooms(
    context: AuthenticatedContext,
    propertyId: string,
    floorId: string | undefined,
    query: string | undefined,
  ) {
    this.assertRole(context);
    const result = await this.repository.listRooms(
      context.organizationId,
      propertyId,
      floorId,
      query,
    );
    if (!result) throw notFound();
    return { data: result };
  }

  async createRoom(
    context: AuthenticatedContext,
    propertyId: string,
    input: { floorId: string; label: string },
  ) {
    this.assertRole(context);
    return {
      data: await this.createNullable(() =>
        this.repository.createRoom(context.organizationId, propertyId, input),
      ),
    };
  }

  async bulkCreateRooms(
    context: AuthenticatedContext,
    propertyId: string,
    input: { rooms: BulkRoomInput[]; dryRun: boolean },
  ) {
    this.assertRole(context);
    let outcome;
    try {
      outcome = await this.repository.bulkCreateRooms(context.organizationId, propertyId, input);
    } catch (error) {
      // The partial unique indexes are the final authority: a concurrent writer that slipped past the pre-check
      // rolls the whole batch back and is reported as the same duplicate conflict.
      this.handleDatabaseError(error);
      const failure = classifyFailure(error);
      if (failure === 'UNIQUE_VIOLATION') {
        throw new ConflictException({ code: 'DUPLICATE_ACTIVE_IDENTIFIER' });
      }
      // Gate wait timed out or the database chose this transaction as a deadlock victim: nothing was written.
      if (failure === 'LOCK_TIMEOUT' || failure === 'DEADLOCK' || failure === 'SERIALIZATION') {
        throw new ConflictException({ code: 'INVENTORY_BUSY' });
      }
      throw error;
    }
    if (outcome.kind === 'not_found') throw notFound();
    if (outcome.kind === 'conflict') {
      throw new ConflictException({
        code: 'DUPLICATE_ACTIVE_IDENTIFIER',
        details: outcome.details,
      });
    }
    return {
      data: {
        propertyId,
        dryRun: input.dryRun,
        limits: { maxRooms: BULK_MAX_ROOMS, maxBeds: BULK_MAX_BEDS },
        summary: {
          rooms: outcome.rooms.length,
          beds: outcome.rooms.reduce((sum, room) => sum + room.beds.length, 0),
        },
        rooms: outcome.rooms,
      },
    };
  }

  async updateRoom(context: AuthenticatedContext, roomId: string, input: { label?: string }) {
    this.assertRole(context);
    return {
      data: await this.update(() =>
        this.repository.updateRoom(context.organizationId, roomId, input),
      ),
    };
  }

  async archiveRoom(context: AuthenticatedContext, roomId: string) {
    this.assertRole(context);
    return {
      data: await this.update(() => this.repository.archiveRoom(context.organizationId, roomId)),
    };
  }

  async listBeds(context: AuthenticatedContext, roomId: string) {
    this.assertRole(context);
    const result = await this.repository.listBeds(context.organizationId, roomId);
    if (!result) throw notFound();
    return { data: result };
  }

  async createBed(
    context: AuthenticatedContext,
    roomId: string,
    input: {
      label: string;
      operationalStatus: 'IN_SERVICE' | 'OUT_OF_SERVICE';
      outOfServiceReason?: string;
    },
  ) {
    this.assertRole(context);
    return {
      data: await this.createNullable(() =>
        this.repository.createBed(context.organizationId, roomId, input),
      ),
    };
  }

  async updateBed(
    context: AuthenticatedContext,
    bedId: string,
    input: {
      label?: string;
      operationalStatus?: 'IN_SERVICE' | 'OUT_OF_SERVICE';
      outOfServiceReason?: string | null;
    },
  ) {
    this.assertRole(context);
    return {
      data: await this.update(() =>
        this.repository.updateBed(context.organizationId, bedId, input),
      ),
    };
  }

  async archiveBed(context: AuthenticatedContext, bedId: string) {
    this.assertRole(context);
    try {
      return {
        data: await this.update(() => this.repository.archiveBed(context.organizationId, bedId)),
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'BED_OCCUPIED') {
        throw new ConflictException({ code: 'BED_OCCUPIED' });
      }
      throw error;
    }
  }

  async getInventorySummary(context: AuthenticatedContext) {
    this.assertRole(context);
    const summary = await this.repository.getInventorySummary(context.organizationId);
    return { data: summary };
  }

  private async create<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.handleDatabaseError(error);
      throw error;
    }
  }

  private async createNullable<T>(operation: () => Promise<T | null>): Promise<T> {
    const result = await this.create(operation);
    if (!result) throw notFound();
    return result;
  }

  private async update<T>(operation: () => Promise<T | null>): Promise<T> {
    const result = await this.create(operation);
    if (!result) throw notFound();
    return result;
  }

  private handleDatabaseError(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException({ code: 'DUPLICATE_ACTIVE_IDENTIFIER' });
    }
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND' });
}
