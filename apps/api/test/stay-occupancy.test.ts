/* eslint-disable @typescript-eslint/no-explicit-any -- service boundary fakes */
import assert from 'node:assert/strict';
import test from 'node:test';
import { activeBedOccupancyWhere, physicalBedId } from '../src/common/stay-occupancy.js';
import { CheckInService } from '../src/checkin/checkin.service.js';
import { BookingService } from '../src/booking/booking.service.js';
import { findOverlappingBooking } from '../src/booking/booking.rules.js';

const segment = { bedId: 'destination', status: 'ACTIVE', endAt: null };
test('physical occupancy follows transferred segment; unbackfilled stays retain legacy bed', () => {
  assert.equal(
    physicalBedId({ bedId: 'original', booking: { stayAssignments: [segment] } }),
    'destination',
  );
  assert.equal(physicalBedId({ bedId: 'original', booking: { stayAssignments: [] } }), 'original');
  for (const segments of [
    [segment, segment],
    [{ ...segment, status: 'COMPLETED', endAt: new Date() }],
  ]) {
    assert.throws(
      () => physicalBedId({ bedId: 'original', booking: { stayAssignments: segments } }),
      { status: 409 },
    );
  }
});

test('bed occupancy predicates scope segment and legacy branches to the tenant', () => {
  const where = activeBedOccupancyWhere('org', 'destination');
  assert.equal(where.organizationId, 'org');
  assert.equal(where.status, 'ACTIVE');
  assert.deepEqual(where.OR, [
    {
      booking: {
        effectiveAssignments: {
          some: { organizationId: 'org', bedId: 'destination', status: 'ACTIVE', endAt: null },
        },
      },
    },
    { bedId: 'destination', booking: { stayAssignments: { none: {} } } },
    {
      booking: {
        effectiveAssignments: { none: { status: 'ACTIVE', endAt: null } },
        stayAssignments: { some: { organizationId: 'org', bedId: 'destination' } },
      },
    },
  ]);
});

test('occupancy and overstay reports use physical beds while preserving booking dates', async () => {
  const rows = [
    {
      id: 'stay',
      bedId: 'original',
      booking: { id: 'booking', endDate: new Date('2020-01-01'), stayAssignments: [segment] },
      resident: { firstName: 'A', lastName: 'B' },
    },
  ];
  const service = new CheckInService({
    db: { checkIn: { findMany: async () => rows }, bed: { count: async () => 2 } },
  } as any);
  const result = await service.occupancy('org');
  assert.deepEqual(result.occupiedBedIds, ['destination']);
  assert.equal(result.overstays[0]!.bedId, 'destination');
});

test('availability excludes active assignment destination and preserves legacy occupancy', async () => {
  const db: any = {
    bed: { findMany: async () => [{ id: 'destination' }, { id: 'legacy' }, { id: 'free' }] },
    checkIn: {
      findMany: async () => [
        { bedId: 'original', booking: { stayAssignments: [segment] } },
        { bedId: 'legacy', booking: { stayAssignments: [] } },
      ],
    },
    $queryRaw: async () => [],
  };
  const result = await new BookingService({ db } as any).getAvailableBeds(
    'org',
    new Date('2027-01-01'),
    new Date('2027-02-01'),
  );
  assert.deepEqual(result, [{ id: 'free' }]);
});

test('overlap read preserves existing reservation checks and adds active assignment destination check', async () => {
  const db: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      assert.match(sql, /UNION ALL/);
      assert.match(sql, /JOIN effective_stay_assignments/);
      assert.match(sql, /s\.status = 'ACTIVE'/);
      assert.match(sql, /Asia\/Kolkata/);
      assert.ok(values.includes('org'));
      assert.ok(values.includes('destination'));
      assert.ok(values.includes('self'));
      return [{ id: 'other-booking' }];
    },
  };
  assert.equal(
    await findOverlappingBooking(db, {
      organizationId: 'org',
      bedId: 'destination',
      start: new Date('2027-01-01'),
      end: new Date('2027-02-01'),
      excludeBookingId: 'self',
    }),
    'other-booking',
  );
});

test('assignment timeline validates continuity and checkout boundaries without changing legacy eligibility', async () => {
  const { assertAssignmentTimeline } = await import('../src/common/stay-occupancy.js');
  const start = new Date('2026-01-01'),
    move = new Date('2026-02-01'),
    out = new Date('2026-03-01');
  const first = {
    bookingId: 'booking',
    residentId: 'resident',
    kind: 'ORIGINAL',
    status: 'COMPLETED',
    startAt: start,
    endAt: move,
  };
  const last = { ...first, kind: 'TRANSFER', status: 'ACTIVE', startAt: move, endAt: null };
  const stay: any = {
    residentId: 'resident',
    status: 'ACTIVE',
    checkInAt: start,
    checkOut: null,
    booking: { id: 'booking', stayAssignments: [first, last] },
  };
  assert.doesNotThrow(() => assertAssignmentTimeline(stay));
  assert.doesNotThrow(() =>
    assertAssignmentTimeline({ ...stay, booking: { id: 'booking', stayAssignments: [] } }),
  );
  for (const patch of [
    { residentId: 'other' },
    { startAt: new Date('2026-02-02') },
    { status: 'COMPLETED' },
  ]) {
    assert.throws(
      () =>
        assertAssignmentTimeline({
          ...stay,
          booking: { id: 'booking', stayAssignments: [first, { ...last, ...patch }] },
        }),
      { status: 409 },
    );
  }
  const completed = {
    ...stay,
    status: 'CHECKED_OUT',
    checkOut: { checkOutAt: out },
    booking: {
      id: 'booking',
      stayAssignments: [first, { ...last, status: 'COMPLETED', endAt: out }],
    },
  };
  assert.doesNotThrow(() => assertAssignmentTimeline(completed));
  assert.throws(
    () =>
      assertAssignmentTimeline({ ...completed, checkOut: { checkOutAt: new Date('2026-03-02') } }),
    { status: 409 },
  );
});
