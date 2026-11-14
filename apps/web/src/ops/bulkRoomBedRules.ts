/**
 * Pure rules for the bulk room and bed screen: label generation, client-side checks, request building, summaries and
 * the wording of server problems. No React and no network, so every rule is unit-tested.
 *
 * The server is the authority. These checks only give fast feedback; the same limits and rules are enforced (and
 * re-checked against existing rooms) by the dry-run and by the real submission.
 */

/** Owner-approved batch limits. Identical for the preview (dry-run) and the real submission. */
export const BULK_MAX_ROOMS = 100;
export const BULK_MAX_BEDS = 200;
export const MAX_LABEL_LENGTH = 32;
export const MAX_REASON_LENGTH = 200;

export type BedStatus = 'IN_SERVICE' | 'OUT_OF_SERVICE';

export interface DraftBed {
  label: string;
  /** New beds default to IN_SERVICE. The value is always shown and editable. */
  operationalStatus: BedStatus;
  outOfServiceReason: string;
}

export interface DraftRoom {
  /** Stable React key; never sent to the server. */
  key: string;
  floorId: string;
  label: string;
  beds: DraftBed[];
}

export interface FieldProblem {
  field: string;
  code: string;
}

/** Default bed labels are 1..n, editable before submission. */
export function defaultBedLabels(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => String(i + 1));
}

export function newBed(label: string): DraftBed {
  return { label, operationalStatus: 'IN_SERVICE', outOfServiceReason: '' };
}

/**
 * Grows or shrinks a room's bed list to `count` beds. Beds that stay keep every edit (label, status, reason); new beds
 * take the lowest unused number, so editing "3" to "A3" and adding a bed gives "3" again, not a duplicate "A3".
 */
export function resizeBeds(beds: readonly DraftBed[], count: number): DraftBed[] {
  const target = Math.max(0, Math.floor(count));
  if (target <= beds.length) return beds.slice(0, target);
  const used = new Set(beds.map((bed) => bed.label.trim()));
  const next = [...beds];
  let candidate = 1;
  while (next.length < target) {
    while (used.has(String(candidate))) candidate += 1;
    next.push(newBed(String(candidate)));
    used.add(String(candidate));
  }
  return next;
}

let counter = 0;
export function newRoomKey(): string {
  counter += 1;
  return `room-${counter}`;
}

export interface RoomPattern {
  floorId: string;
  prefix: string;
  start: number;
  count: number;
  bedsPerRoom: number;
}

/** "Add several rooms at once": prefix + consecutive numbers (for example 101, 102, 103), N default beds each. */
export function roomsFromPattern(pattern: RoomPattern): DraftRoom[] {
  const count = Math.max(0, Math.floor(pattern.count));
  return Array.from({ length: count }, (_, i) => ({
    key: newRoomKey(),
    floorId: pattern.floorId,
    label: `${pattern.prefix.trim()}${pattern.start + i}`,
    beds: defaultBedLabels(pattern.bedsPerRoom).map(newBed),
  }));
}

export function totalBeds(rooms: readonly DraftRoom[]): number {
  return rooms.reduce((sum, room) => sum + room.beds.length, 0);
}

export interface FloorSummary {
  floorId: string;
  rooms: number;
  beds: number;
}

export interface BatchSummary {
  rooms: number;
  beds: number;
  perFloor: FloorSummary[];
  overRoomLimit: boolean;
  overBedLimit: boolean;
}

export function summarize(rooms: readonly DraftRoom[]): BatchSummary {
  const perFloor = new Map<string, FloorSummary>();
  for (const room of rooms) {
    const entry = perFloor.get(room.floorId) ?? { floorId: room.floorId, rooms: 0, beds: 0 };
    entry.rooms += 1;
    entry.beds += room.beds.length;
    perFloor.set(room.floorId, entry);
  }
  const beds = totalBeds(rooms);
  return {
    rooms: rooms.length,
    beds,
    perFloor: [...perFloor.values()],
    overRoomLimit: rooms.length > BULK_MAX_ROOMS,
    overBedLimit: beds > BULK_MAX_BEDS,
  };
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

function labelProblem(raw: string): string | null {
  const value = raw.trim();
  if (value.length < 1) return 'REQUIRED_LABEL';
  if (value.length > MAX_LABEL_LENGTH || hasControlCharacter(value)) return 'INVALID_LENGTH';
  return null;
}

/**
 * Client-side checks, reported under the same indexed paths the server uses (`rooms[2].beds[0].label`), so server and
 * client problems can be shown by one mechanism. Duplicates are matched exactly, as the database indexes do.
 */
export function validateDraft(rooms: readonly DraftRoom[]): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (rooms.length === 0) problems.push({ field: 'rooms', code: 'EMPTY' });
  if (rooms.length > BULK_MAX_ROOMS) problems.push({ field: 'rooms', code: 'TOO_MANY' });
  else if (totalBeds(rooms) > BULK_MAX_BEDS) problems.push({ field: 'beds', code: 'TOO_MANY' });
  const seenRooms = new Set<string>();
  rooms.forEach((room, roomIndex) => {
    if (!room.floorId) problems.push({ field: `rooms[${roomIndex}].floorId`, code: 'REQUIRED' });
    const roomProblem = labelProblem(room.label);
    if (roomProblem) problems.push({ field: `rooms[${roomIndex}].label`, code: roomProblem });
    else if (seenRooms.has(room.label.trim())) {
      problems.push({ field: `rooms[${roomIndex}].label`, code: 'DUPLICATE_IN_REQUEST' });
    }
    if (!roomProblem) seenRooms.add(room.label.trim());
    const seenBeds = new Set<string>();
    room.beds.forEach((bed, bedIndex) => {
      const path = `rooms[${roomIndex}].beds[${bedIndex}]`;
      const bedProblem = labelProblem(bed.label);
      if (bedProblem) problems.push({ field: `${path}.label`, code: bedProblem });
      else if (seenBeds.has(bed.label.trim())) {
        problems.push({ field: `${path}.label`, code: 'DUPLICATE_IN_REQUEST' });
      }
      if (!bedProblem) seenBeds.add(bed.label.trim());
      if (bed.operationalStatus === 'OUT_OF_SERVICE') {
        const reason = bed.outOfServiceReason.trim();
        if (!reason) problems.push({ field: `${path}.outOfServiceReason`, code: 'REQUIRED' });
        else if (reason.length > MAX_REASON_LENGTH || hasControlCharacter(reason)) {
          problems.push({ field: `${path}.outOfServiceReason`, code: 'INVALID_LENGTH' });
        }
      }
    });
  });
  return problems;
}

export interface BulkRequestBody {
  dryRun?: true;
  rooms: Array<{
    floorId: string;
    label: string;
    beds: Array<{ label: string; operationalStatus: BedStatus; outOfServiceReason?: string }>;
  }>;
}

/** The request body. Status is always sent explicitly (the API requires it); the organization is never sent. */
export function toRequestBody(rooms: readonly DraftRoom[], dryRun: boolean): BulkRequestBody {
  return {
    ...(dryRun ? { dryRun: true as const } : {}),
    rooms: rooms.map((room) => ({
      floorId: room.floorId,
      label: room.label.trim(),
      beds: room.beds.map((bed) => ({
        label: bed.label.trim(),
        operationalStatus: bed.operationalStatus,
        ...(bed.operationalStatus === 'OUT_OF_SERVICE'
          ? { outOfServiceReason: bed.outOfServiceReason.trim() }
          : {}),
      })),
    })),
  };
}

const MESSAGES: Record<string, string> = {
  REQUIRED: 'This is required.',
  REQUIRED_LABEL: 'Enter a label.',
  EMPTY: 'Add at least one room.',
  INVALID_LENGTH: `Use 1 to ${MAX_LABEL_LENGTH} characters, with no control characters.`,
  INVALID_UUID: 'Choose a floor.',
  INVALID_ENUM: 'Choose a status.',
  INVALID_STRING: 'Enter text.',
  FORBIDDEN: 'A reason is only for out-of-service beds.',
  UNKNOWN_FIELD: 'This field is not accepted.',
  DUPLICATE_IN_REQUEST: 'Used more than once here. Labels must be unique.',
  DUPLICATE_EXISTING: 'A room with this label already exists in this property.',
  TOO_MANY: 'Too many for one request.',
};

export function describeProblem(problem: FieldProblem): string {
  if (problem.field === 'rooms' && problem.code === 'TOO_MANY') {
    return `A request can create at most ${BULK_MAX_ROOMS} rooms.`;
  }
  if (problem.field === 'beds' && problem.code === 'TOO_MANY') {
    return `A request can create at most ${BULK_MAX_BEDS} beds.`;
  }
  if (problem.field.endsWith('outOfServiceReason') && problem.code === 'REQUIRED') {
    return 'Enter the reason this bed is out of service.';
  }
  if (problem.field.endsWith('.floorId') && problem.code === 'REQUIRED') return 'Choose a floor.';
  return MESSAGES[problem.code] ?? 'This value is not valid.';
}

/** Maps problems to messages by field path. The first message for a path wins. */
export function problemsByField(problems: readonly FieldProblem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const problem of problems) out[problem.field] ??= describeProblem(problem);
  return out;
}

export const roomPath = (roomIndex: number, field: 'label' | 'floorId') =>
  `rooms[${roomIndex}].${field}`;
export const bedPath = (
  roomIndex: number,
  bedIndex: number,
  field: 'label' | 'operationalStatus' | 'outOfServiceReason',
) => `rooms[${roomIndex}].beds[${bedIndex}].${field}`;

/** Server-side problems that are not about one row (shown above the table). */
export function batchLevelProblems(problems: readonly FieldProblem[]): string[] {
  return problems
    .filter((problem) => !problem.field.startsWith('rooms[') && problem.field !== 'propertyId')
    .map(describeProblem);
}

/** What the server answered for a failed bulk request, in words for the person at the screen. */
export function describeFailure(status: number, code: string | undefined): string | null {
  if (status === 404)
    return 'This property or one of its floors was not found. Reload and try again.';
  if (status === 409 && code === 'INVENTORY_BUSY') {
    return 'The system is busy with another change. Nothing was created. Try again in a moment.';
  }
  if (status === 409 && code === 'DUPLICATE_ACTIVE_IDENTIFIER') {
    return 'Some labels are already in use. Nothing was created. Fix the marked rows and try again.';
  }
  if (status === 400) return 'Some values are not valid. Nothing was created. Fix the marked rows.';
  return null;
}

/** Shown when rows are marked but no more specific message applies (for example a purely local check failed). */
export const ROWS_NEED_ATTENTION = 'Some rows need attention. Fix the marked fields.';

/**
 * The one failure message the screen shows for a rejected preview or submission. There is only ever one: a new
 * attempt or any edit replaces it, so a stale message can never sit next to a newer result or contradict it.
 */
export interface BulkFailure {
  source: 'preview' | 'submit';
  message: string;
}

export type BulkFailureEvent =
  | { type: 'preview-failed' | 'submit-failed'; message: string }
  | {
      type:
        | 'edited'
        | 'preview-started'
        | 'preview-succeeded'
        | 'submit-started'
        | 'submit-succeeded'
        | 'back-to-edit'
        | 'reset';
    };

export function nextFailure(
  _current: BulkFailure | null,
  event: BulkFailureEvent,
): BulkFailure | null {
  if (event.type === 'preview-failed') return { source: 'preview', message: event.message };
  if (event.type === 'submit-failed') return { source: 'submit', message: event.message };
  // Every other event means the person has moved on or the last attempt worked: nothing to report.
  return null;
}

/**
 * What the edit step shows above the buttons, without duplicates: server problems that belong to no row, then the
 * failure of the last attempt; the generic "rows need attention" line appears only when nothing more specific does.
 * Row-level problems are not listed here. They are marked on their own fields (see `problemsByField`).
 */
export function editStepMessages(
  problems: readonly FieldProblem[],
  failure: BulkFailure | null,
): string[] {
  const messages = batchLevelProblems(problems);
  if (failure && !messages.includes(failure.message)) messages.push(failure.message);
  if (messages.length === 0 && problems.length > 0) messages.push(ROWS_NEED_ATTENTION);
  return messages;
}
