import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../src/generated/client.js';
import {
  BULK_MAX_BEDS,
  BULK_MAX_ROOMS,
  findBulkConflicts,
  parseBulkRoomsBody,
} from '../src/inventory/inventory.bulk.validation.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import type { BulkRoomsOutcome, InventoryRepository } from '../src/inventory/inventory.types.js';
import type { AuthenticatedContext } from '../src/auth/auth.types.js';

const FLOOR = '11111111-1111-4111-8111-111111111111';
const bed = (label: string, extra: Record<string, unknown> = {}) => ({
  label,
  operationalStatus: 'IN_SERVICE',
  ...extra,
});
const room = (label: string, beds: unknown[] = [bed('1')]) => ({ floorId: FLOOR, label, beds });

function problems(body: unknown): Array<{ field: string; code: string }> {
  try {
    parseBulkRoomsBody(body);
  } catch (error) {
    assert.ok(error instanceof BadRequestException);
    const response = error.getResponse() as {
      code: string;
      details?: Array<{ field: string; code: string }>;
    };
    assert.equal(response.code, 'INVALID_INPUT');
    return response.details ?? [];
  }
  return [];
}

test('a valid request parses; labels are trimmed; dryRun defaults to false', () => {
  const parsed = parseBulkRoomsBody({ rooms: [room(' 101 ', [bed(' 1 '), bed('2')])] });
  assert.equal(parsed.dryRun, false);
  assert.equal(parsed.rooms[0]!.label, '101');
  assert.deepEqual(
    parsed.rooms[0]!.beds.map((b) => b.label),
    ['1', '2'],
  );
  assert.equal(parseBulkRoomsBody({ dryRun: true, rooms: [room('A', [])] }).dryRun, true);
});

test('the approved limits are 100 rooms and 200 beds, applied at the boundary', () => {
  assert.equal(BULK_MAX_ROOMS, 100);
  assert.equal(BULK_MAX_BEDS, 200);
  const rooms = (n: number, beds: number) =>
    Array.from({ length: n }, (_, i) =>
      room(
        `R${i}`,
        Array.from({ length: beds }, (_, b) => bed(`${b + 1}`)),
      ),
    );
  assert.deepEqual(problems({ rooms: rooms(100, 2) }), []); // 100 rooms, exactly 200 beds
  assert.deepEqual(problems({ rooms: rooms(101, 0) }), [{ field: 'rooms', code: 'TOO_MANY' }]);
  assert.deepEqual(problems({ rooms: [...rooms(100, 2)] }).length, 0);
  assert.deepEqual(
    problems({ rooms: rooms(50, 4).concat(rooms(1, 1).map((r) => ({ ...r, label: 'X' }))) }),
    [{ field: 'beds', code: 'TOO_MANY' }],
  ); // 201 beds
});

test('every problem is reported with an indexed path, not just the first', () => {
  const found = problems({
    rooms: [
      { floorId: 'nope', label: '', beds: [] },
      room('ok', [
        bed(''),
        { label: 'x' },
        { label: 'y', operationalStatus: 'BROKEN' },
        { label: 'z', operationalStatus: 'OUT_OF_SERVICE' },
        bed('w', { outOfServiceReason: 'why' }),
      ]),
      'not an object',
    ],
  });
  assert.deepEqual(found, [
    { field: 'rooms[0].floorId', code: 'INVALID_UUID' },
    { field: 'rooms[0].label', code: 'INVALID_LENGTH' },
    { field: 'rooms[1].beds[0].label', code: 'INVALID_LENGTH' },
    { field: 'rooms[1].beds[1].operationalStatus', code: 'REQUIRED' },
    { field: 'rooms[1].beds[2].operationalStatus', code: 'INVALID_ENUM' },
    { field: 'rooms[1].beds[3].outOfServiceReason', code: 'REQUIRED' },
    { field: 'rooms[1].beds[4].outOfServiceReason', code: 'FORBIDDEN' },
    { field: 'rooms[2]', code: 'INVALID_VALUE' },
  ]);
});

test('shape errors: missing, empty, wrong type, unknown and organization fields, bad dryRun, long labels', () => {
  assert.deepEqual(problems({}), [{ field: 'rooms', code: 'REQUIRED' }]);
  assert.deepEqual(problems({ rooms: [] }), [{ field: 'rooms', code: 'EMPTY' }]);
  assert.deepEqual(problems({ rooms: 'x' }), [{ field: 'rooms', code: 'INVALID_VALUE' }]);
  assert.deepEqual(problems({ rooms: [room('a')], extra: 1 }), [
    { field: 'extra', code: 'UNKNOWN_FIELD' },
  ]);
  assert.deepEqual(problems({ rooms: [room('a')], dryRun: 'yes' }), [
    { field: 'dryRun', code: 'INVALID_BOOLEAN' },
  ]);
  assert.deepEqual(problems({ rooms: [{ ...room('a'), propertyId: FLOOR }] }), [
    { field: 'rooms[0].propertyId', code: 'UNKNOWN_FIELD' },
  ]);
  assert.deepEqual(problems({ rooms: [room('x'.repeat(33))] }), [
    { field: 'rooms[0].label', code: 'INVALID_LENGTH' },
  ]);
  assert.deepEqual(problems({ rooms: [room('a\u0000b')] }), [
    { field: 'rooms[0].label', code: 'INVALID_LENGTH' },
  ]);
  for (const body of [null, [], 'x', 7])
    assert.throws(() => parseBulkRoomsBody(body), BadRequestException);
  // organization fields are rejected exactly as on the single-record routes
  assert.throws(
    () => parseBulkRoomsBody({ organizationId: FLOOR, rooms: [room('a')] }),
    BadRequestException,
  );
});

test('conflicts mirror the unique indexes: room label per property, bed label per room, exact match', () => {
  const rooms = [
    { floorId: FLOOR, label: '101', beds: [bed('1'), bed('1')] as never },
    { floorId: FLOOR, label: '101', beds: [] },
    { floorId: FLOOR, label: '102', beds: [bed('1')] as never },
    { floorId: FLOOR, label: 'EXISTING', beds: [] },
    { floorId: FLOOR, label: 'existing', beds: [] }, // case differs: allowed, as the index is case-sensitive
  ];
  assert.deepEqual(findBulkConflicts(rooms, new Set(['EXISTING'])), [
    { field: 'rooms[0].beds[1].label', code: 'DUPLICATE_IN_REQUEST' },
    { field: 'rooms[1].label', code: 'DUPLICATE_IN_REQUEST' },
    { field: 'rooms[3].label', code: 'DUPLICATE_EXISTING' },
  ]);
  assert.deepEqual(findBulkConflicts([rooms[2]!], new Set()), []); // bed "1" may repeat across rooms
});

class FakeRepository {
  calls: Array<{ organizationId: string; propertyId: string; dryRun: boolean }> = [];
  outcome: BulkRoomsOutcome = { kind: 'ok', rooms: [] };
  failure: unknown;
  async bulkCreateRooms(organizationId: string, propertyId: string, input: { dryRun: boolean }) {
    this.calls.push({ organizationId, propertyId, dryRun: input.dryRun });
    if (this.failure) throw this.failure;
    return this.outcome;
  }
}
const ctx = (role: AuthenticatedContext['role'] = 'OWNER'): AuthenticatedContext => ({
  sessionId: 's',
  userId: 'u',
  organizationId: 'org-a',
  organizationName: 'A',
  displayName: 'O',
  role,
  passwordChangeRequired: false,
});
const service = (repo: FakeRepository) =>
  new InventoryService(repo as unknown as InventoryRepository);
const input = { dryRun: false, rooms: [{ floorId: FLOOR, label: '1', beds: [] }] };

test('the service scopes to the session organization and summarizes the result', async () => {
  const repo = new FakeRepository();
  repo.outcome = {
    kind: 'ok',
    rooms: [
      {
        id: 'r1',
        floorId: FLOOR,
        label: '1',
        beds: [{ id: 'b1', label: '1', operationalStatus: 'IN_SERVICE', outOfServiceReason: null }],
      },
      { id: 'r2', floorId: FLOOR, label: '2', beds: [] },
    ],
  };
  const result = await service(repo).bulkCreateRooms(ctx('PROPERTY_MANAGER'), 'p1', input);
  assert.deepEqual(repo.calls, [{ organizationId: 'org-a', propertyId: 'p1', dryRun: false }]);
  assert.deepEqual(result.data.summary, { rooms: 2, beds: 1 });
  assert.equal(result.data.dryRun, false);
});

test('the service maps outcomes and failures to the documented responses', async () => {
  const repo = new FakeRepository();
  repo.outcome = { kind: 'not_found' };
  await assert.rejects(service(repo).bulkCreateRooms(ctx(), 'p', input), NotFoundException);

  repo.outcome = {
    kind: 'conflict',
    details: [{ field: 'rooms[0].label', code: 'DUPLICATE_IN_REQUEST' }],
  };
  await assert.rejects(service(repo).bulkCreateRooms(ctx(), 'p', input), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.deepEqual(error.getResponse(), {
      code: 'DUPLICATE_ACTIVE_IDENTIFIER',
      details: [{ field: 'rooms[0].label', code: 'DUPLICATE_IN_REQUEST' }],
    });
    return true;
  });

  repo.failure = new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: '7.10.1',
  });
  await assert.rejects(service(repo).bulkCreateRooms(ctx(), 'p', input), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.deepEqual((error.getResponse() as { code: string }).code, 'DUPLICATE_ACTIVE_IDENTIFIER');
    return true;
  });

  repo.failure = { code: '55P03' };
  await assert.rejects(service(repo).bulkCreateRooms(ctx(), 'p', input), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.deepEqual((error.getResponse() as { code: string }).code, 'INVENTORY_BUSY');
    return true;
  });

  repo.failure = new Error('boom');
  await assert.rejects(service(repo).bulkCreateRooms(ctx(), 'p', input), /boom/);
});

test('a role that cannot manage inventory is refused before the repository is touched', async () => {
  const repo = new FakeRepository();
  await assert.rejects(
    service(repo).bulkCreateRooms({ ...ctx(), role: 'VIEWER' as never }, 'p', input),
    ForbiddenException,
  );
  assert.equal(repo.calls.length, 0);
});
