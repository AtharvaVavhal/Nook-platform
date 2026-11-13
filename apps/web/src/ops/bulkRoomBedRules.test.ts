import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BULK_MAX_BEDS,
  BULK_MAX_ROOMS,
  batchLevelProblems,
  bedPath,
  defaultBedLabels,
  describeFailure,
  describeProblem,
  newBed,
  problemsByField,
  resizeBeds,
  roomPath,
  roomsFromPattern,
  summarize,
  toRequestBody,
  validateDraft,
  type DraftRoom,
} from './bulkRoomBedRules';
import { opsLinks, parseOpsRoute } from './opsRoute';

const FLOOR_A = '11111111-1111-4111-8111-111111111111';
const FLOOR_B = '22222222-2222-4222-8222-222222222222';

const room = (label: string, labels: string[] = ['1'], floorId = FLOOR_A): DraftRoom => ({
  key: `k-${label}`,
  floorId,
  label,
  beds: labels.map(newBed),
});

test('the limits match the owner-approved values', () => {
  assert.equal(BULK_MAX_ROOMS, 100);
  assert.equal(BULK_MAX_BEDS, 200);
});

test('default bed labels are 1..n and new beds start in service with the value visible', () => {
  assert.deepEqual(defaultBedLabels(4), ['1', '2', '3', '4']);
  assert.deepEqual(defaultBedLabels(0), []);
  assert.deepEqual(defaultBedLabels(-2), []);
  assert.deepEqual(newBed('1'), {
    label: '1',
    operationalStatus: 'IN_SERVICE',
    outOfServiceReason: '',
  });
});

test('resizing keeps edits, takes the lowest unused number and never duplicates a label', () => {
  const edited = [
    { ...newBed('A3'), operationalStatus: 'OUT_OF_SERVICE' as const, outOfServiceReason: 'leak' },
    newBed('2'),
  ];
  const grown = resizeBeds(edited, 4);
  assert.deepEqual(
    grown.map((b) => b.label),
    ['A3', '2', '1', '3'],
  );
  assert.equal(grown[0]!.outOfServiceReason, 'leak');
  assert.deepEqual(resizeBeds(grown, 2), grown.slice(0, 2));
  assert.deepEqual(resizeBeds(grown, 0), []);
  assert.equal(new Set(resizeBeds([], 30).map((b) => b.label)).size, 30);
});

test('a pattern makes consecutive rooms with default beds', () => {
  const rooms = roomsFromPattern({
    floorId: FLOOR_A,
    prefix: ' R',
    start: 101,
    count: 3,
    bedsPerRoom: 2,
  });
  assert.deepEqual(
    rooms.map((r) => r.label),
    ['R101', 'R102', 'R103'],
  );
  assert.ok(
    rooms.every((r) => r.floorId === FLOOR_A && r.beds.map((b) => b.label).join() === '1,2'),
  );
  assert.equal(new Set(rooms.map((r) => r.key)).size, 3, 'every room has its own key');
  assert.deepEqual(
    roomsFromPattern({ floorId: FLOOR_A, prefix: '', start: 1, count: 0, bedsPerRoom: 4 }),
    [],
  );
});

test('the summary counts rooms and beds, overall and per floor, and flags the limits', () => {
  const s = summarize([room('1', ['1', '2']), room('2', ['1'], FLOOR_B), room('3', [], FLOOR_A)]);
  assert.equal(s.rooms, 3);
  assert.equal(s.beds, 3);
  assert.deepEqual(s.perFloor, [
    { floorId: FLOOR_A, rooms: 2, beds: 2 },
    { floorId: FLOOR_B, rooms: 1, beds: 1 },
  ]);
  assert.equal(s.overRoomLimit, false);
  const many = Array.from({ length: 101 }, (_, i) => room(`R${i}`, []));
  assert.equal(summarize(many).overRoomLimit, true);
  assert.equal(summarize([room('x', defaultBedLabels(201))]).overBedLimit, true);
  assert.equal(summarize([room('x', defaultBedLabels(200))]).overBedLimit, false);
});

test('validation reports server-style indexed paths, and accepts a valid 100-bed hostel', () => {
  assert.deepEqual(validateDraft([]), [{ field: 'rooms', code: 'EMPTY' }]);
  const hostel = Array.from({ length: 25 }, (_, i) =>
    room(`R${i}`, defaultBedLabels(4), i < 13 ? FLOOR_A : FLOOR_B),
  );
  assert.deepEqual(validateDraft(hostel), []);
  const bad: DraftRoom[] = [
    room('', ['1']),
    room('dup', ['1', '1', ' ']),
    room('dup', ['1']),
    { ...room('x'.repeat(33)), floorId: '' },
    { ...room('r5', ['b']), beds: [{ ...newBed('b'), operationalStatus: 'OUT_OF_SERVICE' }] },
  ];
  assert.deepEqual(validateDraft(bad), [
    { field: 'rooms[0].label', code: 'REQUIRED_LABEL' },
    { field: 'rooms[1].beds[1].label', code: 'DUPLICATE_IN_REQUEST' },
    { field: 'rooms[1].beds[2].label', code: 'REQUIRED_LABEL' },
    { field: 'rooms[2].label', code: 'DUPLICATE_IN_REQUEST' },
    { field: 'rooms[3].floorId', code: 'REQUIRED' },
    { field: 'rooms[3].label', code: 'INVALID_LENGTH' },
    { field: 'rooms[4].beds[0].outOfServiceReason', code: 'REQUIRED' },
  ]);
  assert.deepEqual(validateDraft(Array.from({ length: 101 }, (_, i) => room(`R${i}`, []))), [
    { field: 'rooms', code: 'TOO_MANY' },
  ]);
  assert.deepEqual(validateDraft([room('a', defaultBedLabels(201))]), [
    { field: 'beds', code: 'TOO_MANY' },
  ]);
});

test('duplicates compare exactly (after trimming), like the database indexes', () => {
  assert.deepEqual(validateDraft([room('a'), room(' a ')]), [
    { field: 'rooms[1].label', code: 'DUPLICATE_IN_REQUEST' },
  ]);
  assert.deepEqual(validateDraft([room('a'), room('A')]), []);
});

test('the request body trims, always sends the status, adds a reason only when out of service, never an organization', () => {
  const r = room(' 101 ', [' 1 ']);
  r.beds.push({ label: '2', operationalStatus: 'OUT_OF_SERVICE', outOfServiceReason: ' broken ' });
  assert.deepEqual(toRequestBody([r], false), {
    rooms: [
      {
        floorId: FLOOR_A,
        label: '101',
        beds: [
          { label: '1', operationalStatus: 'IN_SERVICE' },
          { label: '2', operationalStatus: 'OUT_OF_SERVICE', outOfServiceReason: 'broken' },
        ],
      },
    ],
  });
  const dry = toRequestBody([r], true);
  assert.equal(dry.dryRun, true);
  assert.deepEqual(
    dry.rooms,
    toRequestBody([r], false).rooms,
    'preview and submission send the same rooms',
  );
  const stale = { ...newBed('9'), outOfServiceReason: 'left over' };
  assert.deepEqual(toRequestBody([{ ...r, beds: [stale] }], false).rooms[0]!.beds, [
    { label: '9', operationalStatus: 'IN_SERVICE' },
  ]);
  assert.ok(!JSON.stringify(toRequestBody([r], false)).includes('organization'));
});

test('server problems map to row messages by path; batch-level ones are listed separately', () => {
  const problems = [
    { field: 'rooms[1].label', code: 'DUPLICATE_EXISTING' },
    { field: 'rooms[0].beds[2].label', code: 'DUPLICATE_IN_REQUEST' },
    { field: 'rooms[0].beds[2].label', code: 'INVALID_LENGTH' },
    { field: 'rooms', code: 'TOO_MANY' },
    { field: 'dryRun', code: 'INVALID_BOOLEAN' },
  ];
  const byField = problemsByField(problems);
  assert.equal(
    byField[roomPath(1, 'label')],
    'A room with this label already exists in this property.',
  );
  assert.equal(
    byField[bedPath(0, 2, 'label')],
    describeProblem(problems[1]!),
    'the first message wins',
  );
  assert.deepEqual(batchLevelProblems(problems), [
    'A request can create at most 100 rooms.',
    'This value is not valid.',
  ]);
  assert.equal(
    describeProblem({ field: 'beds', code: 'TOO_MANY' }),
    'A request can create at most 200 beds.',
  );
  assert.equal(
    describeProblem({ field: 'rooms[0].beds[0].outOfServiceReason', code: 'REQUIRED' }),
    'Enter the reason this bed is out of service.',
  );
});

test('failures are explained, always saying nothing was created', () => {
  assert.match(describeFailure(409, 'INVENTORY_BUSY')!, /Nothing was created\. Try again/);
  assert.match(describeFailure(409, 'DUPLICATE_ACTIVE_IDENTIFIER')!, /Nothing was created/);
  assert.match(describeFailure(400, 'INVALID_INPUT')!, /Nothing was created/);
  assert.match(describeFailure(404, 'NOT_FOUND')!, /not found/);
  assert.equal(describeFailure(500, undefined), null);
});

test('the bulk screen has its own hash route and does not hijack the existing room routes', () => {
  assert.equal(opsLinks.roomBulk(FLOOR_A), `#rooms/${FLOOR_A}/bulk`);
  assert.deepEqual(parseOpsRoute(opsLinks.roomBulk(FLOOR_A)), {
    name: 'room-bulk',
    propertyId: FLOOR_A,
  });
  assert.deepEqual(parseOpsRoute(opsLinks.roomNew(FLOOR_A)), {
    name: 'room-new',
    propertyId: FLOOR_A,
  });
  assert.deepEqual(parseOpsRoute(opsLinks.rooms(FLOOR_A)), { name: 'rooms', propertyId: FLOOR_A });
  assert.deepEqual(parseOpsRoute(opsLinks.room(FLOOR_A, FLOOR_B)), {
    name: 'room',
    propertyId: FLOOR_A,
    id: FLOOR_B,
  });
  assert.deepEqual(parseOpsRoute(`#floors/${FLOOR_A}/bulk`), {
    name: 'floors',
    propertyId: FLOOR_A,
  });
});
