import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../src/generated/client.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import type { InventoryRepository } from '../src/inventory/inventory.types.js';
import {
  invalidInput,
  operationalStatusField,
  outOfServiceReasonField,
  rejectOrganizationFields,
} from '../src/inventory/inventory.validation.js';
import type { AuthenticatedContext } from '../src/auth/auth.types.js';

class FakeInventoryRepository implements InventoryRepository {
  organizationIds: string[] = [];
  propertyExists = true;
  floorExists = true;
  roomExists = true;
  bedExists = true;
  duplicate = false;

  private scope(organizationId: string) {
    this.organizationIds.push(organizationId);
  }

  async listProperties(organizationId: string) {
    this.scope(organizationId);
    return [];
  }
  async getProperty(organizationId: string) {
    this.scope(organizationId);
    return this.propertyExists ? { id: 'property-1' } : null;
  }
  async createProperty(organizationId: string) {
    this.scope(organizationId);
    if (this.duplicate) {
      throw new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.10.1',
      });
    }
    return { id: 'property-1' };
  }
  async updateProperty(organizationId: string) {
    this.scope(organizationId);
    return this.propertyExists ? { id: 'property-1' } : null;
  }
  async archiveProperty(organizationId: string) {
    this.scope(organizationId);
    return this.propertyExists ? { id: 'property-1', archivedAt: new Date() } : null;
  }
  async listFloors(organizationId: string) {
    this.scope(organizationId);
    return this.propertyExists ? [] : null;
  }
  async createFloor(organizationId: string) {
    this.scope(organizationId);
    return this.propertyExists ? { id: 'floor-1' } : null;
  }
  async updateFloor(organizationId: string) {
    this.scope(organizationId);
    return this.floorExists ? { id: 'floor-1' } : null;
  }
  async archiveFloor(organizationId: string) {
    this.scope(organizationId);
    return this.floorExists ? { id: 'floor-1' } : null;
  }
  async listRooms(organizationId: string) {
    this.scope(organizationId);
    return this.propertyExists ? [] : null;
  }
  async createRoom(organizationId: string) {
    this.scope(organizationId);
    return this.floorExists ? { id: 'room-1' } : null;
  }
  async updateRoom(organizationId: string) {
    this.scope(organizationId);
    return this.roomExists ? { id: 'room-1' } : null;
  }
  async archiveRoom(organizationId: string) {
    this.scope(organizationId);
    return this.roomExists ? { id: 'room-1' } : null;
  }
  async listBeds(organizationId: string) {
    this.scope(organizationId);
    return this.roomExists ? [] : null;
  }
  async createBed(organizationId: string) {
    this.scope(organizationId);
    return this.roomExists ? { id: 'bed-1' } : null;
  }
  async updateBed(organizationId: string) {
    this.scope(organizationId);
    return this.bedExists ? { id: 'bed-1' } : null;
  }
  async archiveBed(organizationId: string) {
    this.scope(organizationId);
    return this.bedExists ? { id: 'bed-1' } : null;
  }
}

const context = (role: 'OWNER' | 'PROPERTY_MANAGER' = 'OWNER'): AuthenticatedContext => ({
  sessionId: 'session-1',
  userId: 'user-1',
  organizationId: 'organization-a',
  organizationName: 'A',
  displayName: 'Owner',
  role,
});

test('inventory repository operations use only the authenticated organization context', async () => {
  const repository = new FakeInventoryRepository();
  const service = new InventoryService(repository);

  await service.listProperties(context());
  await service.listFloors(context(), 'property-from-client');
  await service.listRooms(context(), 'property-from-client', 'floor-from-client', '101');
  await service.listBeds(context(), 'room-from-client');

  assert.deepEqual(repository.organizationIds, [
    'organization-a',
    'organization-a',
    'organization-a',
    'organization-a',
  ]);
});

test('OWNER and PROPERTY_MANAGER can use inventory operations, while other roles are denied', async () => {
  const repository = new FakeInventoryRepository();
  const service = new InventoryService(repository);

  await assert.doesNotReject(() => service.listProperties(context('OWNER')));
  await assert.doesNotReject(() => service.listProperties(context('PROPERTY_MANAGER')));
  await assert.rejects(
    () => service.listProperties({ ...context(), role: 'UNAPPROVED' as never }),
    ForbiddenException,
  );
});

test('foreign or archived parent references resolve as not found', async () => {
  const repository = new FakeInventoryRepository();
  repository.propertyExists = false;
  repository.floorExists = false;
  const service = new InventoryService(repository);

  await assert.rejects(() => service.listFloors(context(), 'foreign-property'), NotFoundException);
  await assert.rejects(
    () =>
      service.createRoom(context(), 'foreign-property', {
        floorId: 'foreign-floor',
        label: '101',
      }),
    NotFoundException,
  );
});

test('duplicate active identifiers become generic conflict errors', async () => {
  const repository = new FakeInventoryRepository();
  repository.duplicate = true;
  const service = new InventoryService(repository);

  await assert.rejects(
    () => service.createProperty(context(), { code: 'P1', name: 'Property' }),
    ConflictException,
  );
});

test('inventory validation rejects client organization and membership manipulation', () => {
  assert.throws(() => rejectOrganizationFields({ organizationId: 'organization-a' }));
  assert.throws(() => rejectOrganizationFields({ organisationId: 'organization-a' }));
  assert.throws(() => rejectOrganizationFields({ membershipId: 'membership-a' }));
  assert.ok(invalidInput('organizationId', 'UNKNOWN_FIELD'));
});

test('bed status validation enforces the approved enum and reason rules', () => {
  assert.equal(operationalStatusField({ operationalStatus: 'IN_SERVICE' }), 'IN_SERVICE');
  assert.equal(operationalStatusField({ operationalStatus: 'OUT_OF_SERVICE' }), 'OUT_OF_SERVICE');
  assert.throws(() => operationalStatusField({ operationalStatus: 'OCCUPIED' }));
  assert.throws(() => outOfServiceReasonField({}, 'OUT_OF_SERVICE'));
  assert.throws(() => outOfServiceReasonField({ outOfServiceReason: 'unneeded' }, 'IN_SERVICE'));
});
