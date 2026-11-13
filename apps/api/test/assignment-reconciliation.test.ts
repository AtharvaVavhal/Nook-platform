import assert from 'node:assert/strict';
import test from 'node:test';
import {
  replacementSegments,
  type AssignmentSegment,
} from '../src/common/assignment-reconciliation.js';
const before: AssignmentSegment[] = [
  {
    id: 'original',
    bedId: 'A',
    kind: 'ORIGINAL',
    status: 'COMPLETED',
    startAt: '2020-01-01T00:00:00.000001Z',
    endAt: '2021-01-01T00:00:00.000001Z',
    replaceStart: false,
    replaceEnd: false,
  },
  {
    id: 'transfer',
    bedId: 'B',
    kind: 'TRANSFER',
    status: 'COMPLETED',
    startAt: '2021-01-01T00:00:00.000001Z',
    endAt: '2022-01-01T00:00:00.000001Z',
    replaceStart: false,
    replaceEnd: false,
  },
];
test('replacement changes only the approved outer boundary and retains microseconds/history', () => {
  const snapshot = structuredClone(before);
  const result = replacementSegments(before, 'checkInAt', '2020-01-02T05:30:00.123456+05:30');
  assert.equal(result[0]!.startAt, '2020-01-02T00:00:00.123456Z');
  assert.equal(result[0]!.replaceStart, true);
  assert.deepEqual(result[1], before[1]);
  assert.deepEqual(before, snapshot);
  const next = replacementSegments(result, 'checkOutAt', '2022-01-02T00:00:00.654321Z');
  assert.equal(next[0]!.startAt, result[0]!.startAt);
  assert.equal(next[1]!.endAt, '2022-01-02T00:00:00.654321Z');
  assert.equal(next[1]!.replaceEnd, true);
});
test('replacement cannot cross a transfer, create a zero interval, or close an active stay by correction', () => {
  assert.throws(() => replacementSegments(before, 'checkInAt', before[0]!.endAt!), /precede/);
  assert.throws(() => replacementSegments(before, 'checkOutAt', before[1]!.startAt), /follow/);
  assert.throws(
    () =>
      replacementSegments(
        [before[0]!, { ...before[1]!, status: 'ACTIVE', endAt: null }],
        'checkOutAt',
        '2022-01-01T00:00:00Z',
      ),
    /follow/,
  );
  assert.deepEqual(replacementSegments([], 'checkInAt', '2020-01-01T00:00:00Z'), []);
});
test('replacement refuses an existing discontinuous chain and preserves cumulative overrides', () => {
  assert.throws(
    () =>
      replacementSegments(
        [before[0]!, { ...before[1]!, startAt: '2021-01-02T00:00:00.000001Z' }],
        'checkInAt',
        '2020-01-02T00:00:00Z',
      ),
    /continuous/,
  );
  const first = replacementSegments(before, 'checkInAt', '2020-01-02T00:00:00.123456Z');
  const second = replacementSegments(first, 'checkInAt', '2020-01-03T00:00:00.654321Z');
  assert.equal(second[0]!.replaceStart, true);
  assert.equal(second[0]!.startAt, '2020-01-03T00:00:00.654321Z');
});
