import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { parseDateInput } from '../src/common/input.js';
import { assertBedBookable, istDayKey } from '../src/booking/booking.rules.js';

// The overlap query compares Asia/Kolkata calendar days. These tests pin the day each accepted input
// form maps to, which is what makes mixed input forms compare consistently.

const day = (raw: string) => istDayKey(parseDateInput(raw, 'date'));

test('IST day: a date-only value is that calendar day', () => {
  assert.equal(day('2027-01-01'), '2027-01-01');
  assert.equal(day('2027-12-31'), '2027-12-31');
});

test('IST day: IST midnight and the minutes after it belong to the new day', () => {
  assert.equal(day('2027-02-01T00:00'), '2027-02-01'); // zone-less is read as IST wall-clock
  assert.equal(day('2027-02-01T00:00:00+05:30'), '2027-02-01');
  assert.equal(day('2027-01-31T18:30:00Z'), '2027-02-01'); // the same instant in UTC
});

test('IST day: the minute before IST midnight is still the previous day', () => {
  assert.equal(day('2027-01-31T23:59:00+05:30'), '2027-01-31');
  assert.equal(day('2027-01-31T18:29:00Z'), '2027-01-31');
});

test('IST day: zoned timestamps are converted, not read in the host zone', () => {
  assert.equal(day('2027-03-01T00:00:00Z'), '2027-03-01'); // 05:30 IST
  assert.equal(day('2027-03-01T20:00:00Z'), '2027-03-02'); // 01:30 IST next day
  assert.equal(day('2027-03-01T05:00:00-05:00'), '2027-03-01'); // 15:30 IST same day
});

test('IST day: adjacent periods built from mixed forms meet on the same day', () => {
  const aEnd = day('2027-02-01'); // date-only end of the first booking
  const bStart = day('2027-02-01T00:00'); // IST-midnight start of the next
  assert.equal(aEnd, bStart);
  // half-open: existing.end > requested.start is false when they are equal, so no overlap
  assert.equal(aEnd > bStart, false);
});

const bed = (over: Record<string, unknown> = {}) => ({
  archivedAt: null,
  operationalStatus: 'IN_SERVICE',
  room: { archivedAt: null },
  ...over,
});
const today = new Date('2026-11-03T00:00:00Z');
const ctx = (over: Record<string, unknown> = {}) => ({
  hasActiveCheckIn: false,
  start: new Date('2027-01-01T00:00:00Z'),
  end: new Date('2027-02-01T00:00:00Z'),
  today,
  ...over,
});

test('bed usability: an in-service, unarchived, unoccupied bed is bookable', () => {
  assert.doesNotThrow(() => assertBedBookable(bed(), ctx()));
});

test('bed usability: an archived bed or an archived room is a 409', () => {
  assert.throws(
    () => assertBedBookable(bed({ archivedAt: new Date() }), ctx()),
    (e) => e instanceof ConflictException && /archived/.test(e.message),
  );
  assert.throws(
    () => assertBedBookable(bed({ room: { archivedAt: new Date() } }), ctx()),
    (e) => e instanceof ConflictException && /archived/.test(e.message),
  );
});

test('bed usability: an out-of-service bed is a 409', () => {
  assert.throws(
    () => assertBedBookable(bed({ operationalStatus: 'OUT_OF_SERVICE' }), ctx()),
    (e) => e instanceof ConflictException && /out of service/.test(e.message),
  );
});

test('bed usability: an active check-in blocks a period that includes today', () => {
  const occupied = ctx({
    hasActiveCheckIn: true,
    start: new Date('2026-10-01T00:00:00Z'),
    end: new Date('2026-12-01T00:00:00Z'),
  });
  assert.throws(
    () => assertBedBookable(bed(), occupied),
    (e) => e instanceof ConflictException && /occupied/.test(e.message),
  );
});

test('bed usability: the period is half-open, so ending today does not include today', () => {
  assert.doesNotThrow(() =>
    assertBedBookable(
      bed(),
      ctx({
        hasActiveCheckIn: true,
        start: new Date('2026-10-01T00:00:00Z'),
        end: new Date('2026-11-03T00:00:00Z'),
      }),
    ),
  );
});

test('bed usability: with an active check-in a later period is left to the date overlap rule', () => {
  // Owner decision pending for an overstaying occupant: this rule deliberately does not decide it.
  assert.doesNotThrow(() => assertBedBookable(bed(), ctx({ hasActiveCheckIn: true })));
});

test('bed usability: no active check-in never blocks on occupancy', () => {
  assert.doesNotThrow(() =>
    assertBedBookable(
      bed(),
      ctx({
        start: new Date('2026-10-01T00:00:00Z'),
        end: new Date('2026-12-01T00:00:00Z'),
      }),
    ),
  );
});
