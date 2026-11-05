import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  assertCanCheckIn,
  assertCanCheckOut,
  optionalText,
  isOverstay,
  resolveInstant,
  type CheckInFacts,
} from '../src/checkin/checkin.rules.js';

const ok = (): CheckInFacts => ({
  admission: { status: 'ADMITTED' },
  booking: { status: 'CONFIRMED' },
  bed: { archivedAt: null, operationalStatus: 'IN_SERVICE', room: { archivedAt: null } },
  existingForAdmission: null,
  activeOnBed: false,
  activeForResident: false,
});
const refused = (patch: Partial<CheckInFacts>, pattern: RegExp) =>
  assert.throws(
    () => assertCanCheckIn({ ...ok(), ...patch }),
    (e: unknown) => e instanceof ConflictException && pattern.test((e as Error).message),
  );

test('check-in is allowed for an admitted admission, confirmed booking and in-service bed', () => {
  assert.doesNotThrow(() => assertCanCheckIn(ok()));
});

test('check-in requires an ADMITTED admission', () => {
  refused({ admission: { status: 'PENDING' } }, /admitted/i);
  refused({ admission: { status: 'CANCELLED' } }, /admitted/i);
});

test('check-in requires a CONFIRMED booking', () => {
  refused({ booking: { status: 'CANCELLED' } }, /not confirmed/i);
});

test('archived bed, archived room and out-of-service bed cannot be checked into', () => {
  const bed = ok().bed;
  refused({ bed: { ...bed, archivedAt: new Date() } }, /archived/i);
  refused({ bed: { ...bed, room: { archivedAt: new Date() } } }, /archived/i);
  refused({ bed: { ...bed, operationalStatus: 'OUT_OF_SERVICE' } }, /out of service/i);
});

test('duplicate active check-ins are refused: same admission, same bed, same resident', () => {
  refused({ existingForAdmission: { status: 'ACTIVE' } }, /active check-in/i);
  refused({ existingForAdmission: { status: 'CHECKED_OUT' } }, /already been checked in and out/i);
  refused({ activeOnBed: true }, /occupied/i);
  refused({ activeForResident: true }, /resident already has/i);
});

test('check-out needs an active check-in and a time that is not before check-in', () => {
  const checkInAt = new Date('2026-12-02T08:00:00Z');
  assert.doesNotThrow(() =>
    assertCanCheckOut({ status: 'ACTIVE', checkInAt }, new Date('2026-12-02T08:00:00Z')),
  );
  assert.throws(
    () => assertCanCheckOut({ status: 'CHECKED_OUT', checkInAt }, new Date('2027-01-01T00:00:00Z')),
    ConflictException,
  );
  assert.throws(
    () => assertCanCheckOut({ status: 'ACTIVE', checkInAt }, new Date('2026-12-02T07:59:59Z')),
    BadRequestException,
  );
});

test('timestamps default to now and zone-less values are Asia/Kolkata, not server time', () => {
  const now = new Date('2026-11-02T10:00:00Z');
  assert.equal(resolveInstant(undefined, 'x', now), now);
  assert.equal(resolveInstant('', 'x', now), now);
  // 08:00 in India is 02:30 UTC
  assert.equal(resolveInstant('2026-12-02T08:00', 'x').toISOString(), '2026-12-02T02:30:00.000Z');
  assert.equal(
    resolveInstant('2026-12-02 08:00:30', 'x').toISOString(),
    '2026-12-02T02:30:30.000Z',
  );
  assert.equal(resolveInstant('2026-12-02', 'x').toISOString(), '2026-12-01T18:30:00.000Z');
  // an explicit zone is honoured as given
  assert.equal(
    resolveInstant('2026-12-02T08:00:00Z', 'x').toISOString(),
    '2026-12-02T08:00:00.000Z',
  );
  assert.equal(
    resolveInstant('2026-12-02T08:00:00+05:30', 'x').toISOString(),
    '2026-12-02T02:30:00.000Z',
  );
});

test('malformed timestamps are a 400, not an Invalid Date', () => {
  for (const bad of ['nope', '2026-13-45T00:00', '2026-12-02T25:00', 12345, {}]) {
    assert.throws(() => resolveInstant(bad, 'checkInAt'), BadRequestException, String(bad));
  }
});

test('optional text is trimmed, empty becomes null, and over-long input is a 400', () => {
  assert.equal(optionalText(undefined, 'reason', 10), null);
  assert.equal(optionalText('   ', 'reason', 10), null);
  assert.equal(optionalText('  moved out ', 'reason', 20), 'moved out');
  assert.throws(() => optionalText('x'.repeat(11), 'reason', 10), BadRequestException);
  assert.throws(() => optionalText(5, 'reason', 10), BadRequestException);
});

test('overstay: a checked-in resident is past the booking from the exclusive end date (Asia/Kolkata)', () => {
  const end = new Date('2026-11-01T00:00:00Z');
  assert.equal(isOverstay(end, new Date('2026-10-31T18:29:00Z')), false); // 31 Oct in India
  assert.equal(isOverstay(end, new Date('2026-10-31T18:30:00Z')), true); // 1 Nov in India
  assert.equal(isOverstay(end, new Date('2026-11-15T05:00:00Z')), true);
  assert.equal(
    isOverstay(new Date('2027-01-01T00:00:00Z'), new Date('2026-12-31T05:00:00Z')),
    false,
  );
});
