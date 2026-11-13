import { BadRequestException } from '@nestjs/common';
import { parseBody, parseUuid, rejectOrganizationFields } from './inventory.validation.js';

/** Owner-approved batch limits (Phase 3 Task 1, D2). Identical for dry-run and actual submission. */
export const BULK_MAX_ROOMS = 100;
export const BULK_MAX_BEDS = 200;

export type BulkBedStatus = 'IN_SERVICE' | 'OUT_OF_SERVICE';

export interface BulkBedInput {
  label: string;
  operationalStatus: BulkBedStatus;
  outOfServiceReason?: string;
}

export interface BulkRoomInput {
  floorId: string;
  label: string;
  beds: BulkBedInput[];
}

export interface BulkRoomsInput {
  dryRun: boolean;
  rooms: BulkRoomInput[];
}

export interface FieldProblem {
  field: string;
  code: string;
}

const MAX_LABEL = 32;
const MAX_REASON = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

/** Same rules as the single-record `labelField`: a trimmed string of 1-32 characters with no control characters. */
function checkLabel(value: unknown, field: string, problems: FieldProblem[]): string | undefined {
  if (value === undefined) {
    problems.push({ field, code: 'REQUIRED' });
    return undefined;
  }
  if (typeof value !== 'string') {
    problems.push({ field, code: 'INVALID_STRING' });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_LABEL || hasControlCharacter(trimmed)) {
    problems.push({ field, code: 'INVALID_LENGTH' });
    return undefined;
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseBed(raw: unknown, path: string, problems: FieldProblem[]): BulkBedInput | undefined {
  if (!isRecord(raw)) {
    problems.push({ field: path, code: 'INVALID_VALUE' });
    return undefined;
  }
  const before = problems.length;
  for (const field of [
    'organizationId',
    'organisationId',
    'membershipId',
    'propertyId',
    'roomId',
  ]) {
    if (field in raw) problems.push({ field: `${path}.${field}`, code: 'UNKNOWN_FIELD' });
  }
  const label = checkLabel(raw.label, `${path}.label`, problems);
  let operationalStatus: BulkBedStatus | undefined;
  if (raw.operationalStatus === undefined) {
    problems.push({ field: `${path}.operationalStatus`, code: 'REQUIRED' });
  } else if (raw.operationalStatus !== 'IN_SERVICE' && raw.operationalStatus !== 'OUT_OF_SERVICE') {
    problems.push({ field: `${path}.operationalStatus`, code: 'INVALID_ENUM' });
  } else {
    operationalStatus = raw.operationalStatus;
  }
  let reason: string | undefined;
  if (raw.outOfServiceReason !== undefined) {
    if (typeof raw.outOfServiceReason !== 'string') {
      problems.push({ field: `${path}.outOfServiceReason`, code: 'INVALID_STRING' });
    } else {
      const trimmed = raw.outOfServiceReason.trim();
      if (trimmed.length < 1 || trimmed.length > MAX_REASON || hasControlCharacter(trimmed)) {
        problems.push({ field: `${path}.outOfServiceReason`, code: 'INVALID_LENGTH' });
      } else {
        reason = trimmed;
      }
    }
  }
  if (operationalStatus === 'OUT_OF_SERVICE' && raw.outOfServiceReason === undefined) {
    problems.push({ field: `${path}.outOfServiceReason`, code: 'REQUIRED' });
  }
  if (operationalStatus === 'IN_SERVICE' && raw.outOfServiceReason !== undefined) {
    problems.push({ field: `${path}.outOfServiceReason`, code: 'FORBIDDEN' });
  }
  if (problems.length > before || !label || !operationalStatus) return undefined;
  return {
    label,
    operationalStatus,
    ...(reason !== undefined ? { outOfServiceReason: reason } : {}),
  };
}

function parseRoom(
  raw: unknown,
  path: string,
  problems: FieldProblem[],
): BulkRoomInput | undefined {
  if (!isRecord(raw)) {
    problems.push({ field: path, code: 'INVALID_VALUE' });
    return undefined;
  }
  const before = problems.length;
  for (const field of ['organizationId', 'organisationId', 'membershipId', 'propertyId']) {
    if (field in raw) problems.push({ field: `${path}.${field}`, code: 'UNKNOWN_FIELD' });
  }
  let floorId: string | undefined;
  if (raw.floorId === undefined) {
    problems.push({ field: `${path}.floorId`, code: 'REQUIRED' });
  } else if (typeof raw.floorId !== 'string' || !UUID.test(raw.floorId)) {
    problems.push({ field: `${path}.floorId`, code: 'INVALID_UUID' });
  } else {
    floorId = raw.floorId;
  }
  const label = checkLabel(raw.label, `${path}.label`, problems);
  const beds: BulkBedInput[] = [];
  if (raw.beds !== undefined) {
    if (!Array.isArray(raw.beds)) {
      problems.push({ field: `${path}.beds`, code: 'INVALID_VALUE' });
    } else {
      raw.beds.forEach((bed, index) => {
        const parsed = parseBed(bed, `${path}.beds[${index}]`, problems);
        if (parsed) beds.push(parsed);
      });
    }
  }
  if (problems.length > before || !floorId || !label) return undefined;
  return { floorId, label, beds };
}

/**
 * Parses and validates a whole bulk request, collecting EVERY problem with an indexed field path
 * (`rooms[3].beds[1].label`) instead of stopping at the first. The same function serves dry-run and
 * actual submission, so the two cannot disagree about what is a valid payload.
 */
export function parseBulkRoomsBody(body: unknown): BulkRoomsInput {
  const input = parseBody(body);
  rejectOrganizationFields(input);
  const problems: FieldProblem[] = [];
  let dryRun = false;
  if (input.dryRun !== undefined) {
    if (typeof input.dryRun !== 'boolean')
      problems.push({ field: 'dryRun', code: 'INVALID_BOOLEAN' });
    else dryRun = input.dryRun;
  }
  for (const field of Object.keys(input)) {
    if (field !== 'rooms' && field !== 'dryRun') problems.push({ field, code: 'UNKNOWN_FIELD' });
  }
  const rooms: BulkRoomInput[] = [];
  if (input.rooms === undefined) {
    problems.push({ field: 'rooms', code: 'REQUIRED' });
  } else if (!Array.isArray(input.rooms)) {
    problems.push({ field: 'rooms', code: 'INVALID_VALUE' });
  } else if (input.rooms.length === 0) {
    problems.push({ field: 'rooms', code: 'EMPTY' });
  } else if (input.rooms.length > BULK_MAX_ROOMS) {
    problems.push({ field: 'rooms', code: 'TOO_MANY' });
  } else {
    input.rooms.forEach((room, index) => {
      const parsed = parseRoom(room, `rooms[${index}]`, problems);
      if (parsed) rooms.push(parsed);
    });
    const bedCount = input.rooms.reduce<number>(
      (sum, room) =>
        sum + (isRecord(room) && Array.isArray(room.beds) ? (room.beds as unknown[]).length : 0),
      0,
    );
    if (bedCount > BULK_MAX_BEDS) problems.push({ field: 'beds', code: 'TOO_MANY' });
  }
  if (problems.length) {
    throw new BadRequestException({ code: 'INVALID_INPUT', details: problems });
  }
  return { dryRun, rooms };
}

export function parseBulkPropertyId(value: string): string {
  return parseUuid(value, 'propertyId');
}

/**
 * The uniqueness rules, mirrored from the partial unique indexes (active rows only):
 *  - room label: unique per PROPERTY (`rooms_property_id_label_active_key`), across every floor of the request;
 *  - bed label: unique per ROOM (`beds_room_id_label_active_key`).
 * `existingRoomLabels` are the labels of active rooms already in the property. A new room cannot collide on bed
 * labels with existing rooms, because every room in the request is new.
 * Comparison is exact (case-sensitive), as the indexes are.
 * Used by dry-run and actual submission alike.
 */
export function findBulkConflicts(
  rooms: readonly BulkRoomInput[],
  existingRoomLabels: ReadonlySet<string>,
): FieldProblem[] {
  const conflicts: FieldProblem[] = [];
  const seenRooms = new Map<string, number>();
  rooms.forEach((room, roomIndex) => {
    const field = `rooms[${roomIndex}].label`;
    if (existingRoomLabels.has(room.label)) {
      conflicts.push({ field, code: 'DUPLICATE_EXISTING' });
    } else if (seenRooms.has(room.label)) {
      conflicts.push({ field, code: 'DUPLICATE_IN_REQUEST' });
    }
    if (!seenRooms.has(room.label)) seenRooms.set(room.label, roomIndex);
    const seenBeds = new Set<string>();
    room.beds.forEach((bed, bedIndex) => {
      if (seenBeds.has(bed.label)) {
        conflicts.push({
          field: `rooms[${roomIndex}].beds[${bedIndex}].label`,
          code: 'DUPLICATE_IN_REQUEST',
        });
      }
      seenBeds.add(bed.label);
    });
  });
  return conflicts;
}
