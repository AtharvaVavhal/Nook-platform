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
    return {
      data: await this.update(() => this.repository.archiveBed(context.organizationId, bedId)),
    };
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
