import type { AuthenticatedContext } from '../auth/auth.types.js';

export type InventoryResource = 'property' | 'floor' | 'room' | 'bed';

export interface InventoryRepository {
  listProperties(organizationId: string): Promise<unknown[]>;
  getProperty(organizationId: string, propertyId: string): Promise<unknown | null>;
  createProperty(organizationId: string, input: { code: string; name: string }): Promise<unknown>;
  updateProperty(
    organizationId: string,
    propertyId: string,
    input: { code?: string; name?: string },
  ): Promise<unknown | null>;
  archiveProperty(organizationId: string, propertyId: string): Promise<unknown | null>;
  listFloors(organizationId: string, propertyId: string): Promise<unknown[] | null>;
  createFloor(
    organizationId: string,
    propertyId: string,
    input: { label: string; ordinal: number },
  ): Promise<unknown | null>;
  updateFloor(
    organizationId: string,
    floorId: string,
    input: { label?: string; ordinal?: number },
  ): Promise<unknown | null>;
  archiveFloor(organizationId: string, floorId: string): Promise<unknown | null>;
  listRooms(
    organizationId: string,
    propertyId: string,
    floorId: string | undefined,
    query: string | undefined,
  ): Promise<unknown[] | null>;
  createRoom(
    organizationId: string,
    propertyId: string,
    input: { floorId: string; label: string },
  ): Promise<unknown | null>;
  updateRoom(
    organizationId: string,
    roomId: string,
    input: { label?: string },
  ): Promise<unknown | null>;
  archiveRoom(organizationId: string, roomId: string): Promise<unknown | null>;
  listBeds(organizationId: string, roomId: string): Promise<unknown[] | null>;
  createBed(
    organizationId: string,
    roomId: string,
    input: {
      label: string;
      operationalStatus: 'IN_SERVICE' | 'OUT_OF_SERVICE';
      outOfServiceReason?: string;
    },
  ): Promise<unknown | null>;
  updateBed(
    organizationId: string,
    bedId: string,
    input: {
      label?: string;
      operationalStatus?: 'IN_SERVICE' | 'OUT_OF_SERVICE';
      outOfServiceReason?: string | null;
    },
  ): Promise<unknown | null>;
  archiveBed(organizationId: string, bedId: string): Promise<unknown | null>;
  getInventorySummary(organizationId: string): Promise<{
    properties: number;
    floors: number;
    rooms: number;
    beds: number;
    bedsInService: number;
    bedsOutOfService: number;
    bedsArchived: number;
  }>;
}

export function canManageInventory(context: AuthenticatedContext): boolean {
  return context.role === 'OWNER' || context.role === 'PROPERTY_MANAGER';
}
