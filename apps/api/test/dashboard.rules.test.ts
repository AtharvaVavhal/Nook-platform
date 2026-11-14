import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { PERMISSIONS, roleHasPermission, type Permission } from '../src/auth/permissions.js';
import { isOverstay } from '../src/checkin/checkin.rules.js';
import {
  DASHBOARD_LIST_CAP,
  addDays,
  allowedMonths,
  classifyStayEnd,
  computeGates,
  dashboardWindows,
  daysPastEnd,
  dateKey,
  fullName,
  istDateKey,
  mergeActivity,
  occupancyPercent,
  summarizeInventory,
  validateDashboardRequest,
} from '../src/dashboard/dashboard.rules.js';
import type { ActivityItem } from '../src/dashboard/dashboard.types.js';

const PROPERTY = '11111111-1111-4111-8111-111111111111';
/** 2026-11-14 15:30 IST. */
const NOW = new Date('2026-11-14T10:00:00Z');

function problems(propertyId: string, query: Record<string, unknown>, now = NOW) {
  try {
    validateDashboardRequest(propertyId, query, now);
  } catch (error) {
    assert.ok(error instanceof BadRequestException);
    const body = error.getResponse() as {
      code: string;
      details: Array<{ field: string; code: string }>;
    };
    assert.equal(body.code, 'INVALID_INPUT');
    return body.details;
  }
  return [];
}

// ------------------------------------------------------------------------------------------------ validation

test('defaults: the current IST month and 14 days', () => {
  const result = validateDashboardRequest(PROPERTY, {}, NOW);
  assert.deepEqual(result, { propertyId: PROPERTY, params: { month: '2026-11', days: 14 } });
});

test('the selectable months are the current IST month and the five before it', () => {
  assert.deepEqual(allowedMonths(NOW), [
    '2026-06',
    '2026-07',
    '2026-08',
    '2026-09',
    '2026-10',
    '2026-11',
  ]);
  // The month rolls over at IST midnight, not UTC midnight.
  assert.equal(allowedMonths(new Date('2026-11-30T18:29:59Z')).at(-1), '2026-11');
  assert.equal(allowedMonths(new Date('2026-11-30T18:30:00Z')).at(-1), '2026-12');
  assert.deepEqual(allowedMonths(new Date('2026-01-10T00:00:00Z')).slice(0, 2), [
    '2025-08',
    '2025-09',
  ]);
});

test('month: the current and the previous five are accepted, the sixth back and any future month are OUT_OF_RANGE', () => {
  for (const month of ['2026-11', '2026-10', '2026-06']) {
    assert.equal(validateDashboardRequest(PROPERTY, { month }, NOW).params.month, month);
  }
  assert.deepEqual(problems(PROPERTY, { month: '2026-05' }), [
    { field: 'month', code: 'OUT_OF_RANGE' },
  ]);
  assert.deepEqual(problems(PROPERTY, { month: '2026-12' }), [
    { field: 'month', code: 'OUT_OF_RANGE' },
  ]);
  assert.deepEqual(problems(PROPERTY, { month: '2099-01' }), [
    { field: 'month', code: 'OUT_OF_RANGE' },
  ]);
});

test('month: a malformed value is INVALID_FORMAT', () => {
  for (const month of [
    '2026-13',
    '2026-00',
    'abc',
    '2026-1',
    '2026-11-01',
    '',
    ' 2026-11',
    ['2026-11', '2026-10'],
  ]) {
    assert.deepEqual(
      problems(PROPERTY, { month }),
      [{ field: 'month', code: 'INVALID_FORMAT' }],
      JSON.stringify(month),
    );
  }
});

test('days: 1 to 31 are accepted; outside is OUT_OF_RANGE; a non-integer is INVALID_INTEGER', () => {
  for (const days of ['1', '14', '31', '014']) {
    assert.equal(validateDashboardRequest(PROPERTY, { days }, NOW).params.days, Number(days));
  }
  for (const days of ['0', '32', '-1', '99999999999999999999']) {
    assert.deepEqual(problems(PROPERTY, { days }), [{ field: 'days', code: 'OUT_OF_RANGE' }], days);
  }
  for (const days of ['1.5', '', 'abc', '1e1', ['1', '2']]) {
    assert.deepEqual(
      problems(PROPERTY, { days }),
      [{ field: 'days', code: 'INVALID_INTEGER' }],
      JSON.stringify(days),
    );
  }
});

test('unknown parameters, including an organization field, are refused', () => {
  assert.deepEqual(problems(PROPERTY, { organizationId: 'x' }), [
    { field: 'organizationId', code: 'UNKNOWN_FIELD' },
  ]);
  assert.deepEqual(problems(PROPERTY, { page: '2' }), [{ field: 'page', code: 'UNKNOWN_FIELD' }]);
});

test('a malformed property id is INVALID_UUID, and every problem is reported together', () => {
  assert.deepEqual(problems('not-a-uuid', {}), [{ field: 'propertyId', code: 'INVALID_UUID' }]);
  assert.deepEqual(problems('nope', { month: 'x', days: '0', extra: '1' }), [
    { field: 'propertyId', code: 'INVALID_UUID' },
    { field: 'extra', code: 'UNKNOWN_FIELD' },
    { field: 'month', code: 'INVALID_FORMAT' },
    { field: 'days', code: 'OUT_OF_RANGE' },
  ]);
});

// ------------------------------------------------------------------------------------------------ windows

test('windows: upcoming is [today, today + days) and recent is (today - days, today], at Asia/Kolkata midnights', () => {
  const w = dashboardWindows(NOW, 14);
  assert.equal(dateKey(w.today), '2026-11-14');
  assert.equal(dateKey(w.upcomingFrom), '2026-11-14');
  assert.equal(dateKey(w.upcomingToExclusive), '2026-11-28');
  assert.equal(dateKey(w.recentFrom), '2026-11-01');
  assert.equal(dateKey(w.recentTo), '2026-11-14');
  // instants: IST midnight = 18:30 UTC of the previous day
  assert.equal(w.upcomingStart.toISOString(), '2026-11-13T18:30:00.000Z');
  assert.equal(w.upcomingEnd.toISOString(), '2026-11-27T18:30:00.000Z');
  assert.equal(w.recentStart.toISOString(), '2026-10-31T18:30:00.000Z');
  assert.equal(w.recentEnd.toISOString(), '2026-11-14T18:30:00.000Z');
});

test('windows: days = 1 is today only for the recent window and [today, tomorrow) for the upcoming one', () => {
  const w = dashboardWindows(NOW, 1);
  assert.equal(dateKey(w.recentFrom), '2026-11-14');
  assert.equal(dateKey(w.recentTo), '2026-11-14');
  assert.equal(dateKey(w.upcomingToExclusive), '2026-11-15');
});

test('windows: today changes at IST midnight, not UTC midnight', () => {
  assert.equal(dateKey(dashboardWindows(new Date('2026-11-14T18:29:59Z'), 14).today), '2026-11-14');
  assert.equal(dateKey(dashboardWindows(new Date('2026-11-14T18:30:00Z'), 14).today), '2026-11-15');
  assert.equal(dateKey(dashboardWindows(new Date('2026-11-14T00:00:00Z'), 14).today), '2026-11-14');
});

test('an instant is inside a window exactly when its IST day is: 18:29:59Z vs 18:30:00Z', () => {
  const w = dashboardWindows(NOW, 14);
  const inRecent = (instant: Date) => instant >= w.recentStart && instant < w.recentEnd;
  assert.equal(inRecent(new Date('2026-10-31T18:29:59Z')), false); // IST 2026-10-31: before R
  assert.equal(inRecent(new Date('2026-10-31T18:30:00Z')), true); // IST 2026-11-01: first day of R
  assert.equal(inRecent(new Date('2026-11-14T18:29:59Z')), true); // IST 2026-11-14: today, last moment
  assert.equal(inRecent(new Date('2026-11-14T18:30:00Z')), false); // IST 2026-11-15: tomorrow
  const inUpcoming = (instant: Date) => instant >= w.upcomingStart && instant < w.upcomingEnd;
  assert.equal(inUpcoming(new Date('2026-11-13T18:29:59Z')), false);
  assert.equal(inUpcoming(new Date('2026-11-13T18:30:00Z')), true);
  assert.equal(inUpcoming(new Date('2026-11-27T18:29:59Z')), true); // last day of U (today + 13)
  assert.equal(inUpcoming(new Date('2026-11-27T18:30:00Z')), false); // today + 14 is excluded
});

// ------------------------------------------------------------------------------------------------ D7 boundary

test('D7: a booking ending today is an upcoming check-out, not past end date; yesterday is past end date', () => {
  const w = dashboardWindows(NOW, 14);
  const day = (offset: number) => addDays(w.today, offset); // UTC-midnight value, as date-only inputs are stored
  assert.equal(classifyStayEnd(day(0), w), 'UPCOMING'); // ends today
  assert.equal(classifyStayEnd(day(-1), w), 'PAST_END'); // ended yesterday
  assert.equal(classifyStayEnd(day(13), w), 'UPCOMING'); // last day of the window
  assert.equal(classifyStayEnd(day(14), w), 'LATER'); // today + days is excluded
  assert.equal(classifyStayEnd(day(-30), w), 'PAST_END');
});

test('D7: the classification compares IST days at the instant edge', () => {
  const w = dashboardWindows(new Date('2026-11-15T04:00:00Z'), 14); // today = 2026-11-15 IST
  assert.equal(classifyStayEnd(new Date('2026-11-14T18:29:59Z'), w), 'PAST_END'); // IST 2026-11-14
  assert.equal(classifyStayEnd(new Date('2026-11-14T18:30:00Z'), w), 'UPCOMING'); // IST 2026-11-15 = today
});

test('D7: the existing isOverstay rule is unchanged and deliberately differs for a booking ending today', () => {
  const w = dashboardWindows(NOW, 14);
  const endsToday = w.today;
  assert.equal(isOverstay(endsToday, NOW), true); // existing rule: end <= today is an overstay
  assert.equal(classifyStayEnd(endsToday, w), 'UPCOMING'); // dashboard rule: not past end date
  const endedYesterday = addDays(w.today, -1);
  assert.equal(isOverstay(endedYesterday, NOW), true);
  assert.equal(classifyStayEnd(endedYesterday, w), 'PAST_END');
  const endsTomorrow = addDays(w.today, 1);
  assert.equal(isOverstay(endsTomorrow, NOW), false);
  assert.equal(classifyStayEnd(endsTomorrow, w), 'UPCOMING');
});

test('daysPastEnd is the whole IST days since the end date, at least 1 for a past end date', () => {
  const today = dashboardWindows(NOW, 14).today;
  assert.equal(daysPastEnd(addDays(today, -1), today), 1);
  assert.equal(daysPastEnd(addDays(today, -10), today), 10);
  assert.equal(daysPastEnd(new Date('2026-11-12T18:30:00Z'), today), 1); // IST 2026-11-13
});

// ------------------------------------------------------------------------------------------------ inventory

test('occupancy percentage: one decimal, half up, zero for an empty property', () => {
  assert.equal(occupancyPercent(0, 0), 0);
  assert.equal(occupancyPercent(5, 0), 0);
  assert.equal(occupancyPercent(0, 100), 0);
  assert.equal(occupancyPercent(62, 100), 62);
  assert.equal(occupancyPercent(100, 100), 100);
  assert.equal(occupancyPercent(1, 3), 33.3);
  assert.equal(occupancyPercent(2, 3), 66.7);
  assert.equal(occupancyPercent(1, 8), 12.5);
  assert.equal(occupancyPercent(1, 16), 6.3); // 6.25 rounds half up
  assert.equal(occupancyPercent(1, 6), 16.7);
});

const floors = [
  { id: 'f2', label: 'Second', ordinal: 2 },
  { id: 'f1', label: 'First', ordinal: 1 },
  { id: 'f3', label: 'Empty', ordinal: 3 },
];
const bed = (id: string, floorId: string, outOfService = false) => ({ id, floorId, outOfService });

test('inventory: occupied + available + out of service always equals the live beds', () => {
  const beds = [
    bed('a', 'f1'),
    bed('b', 'f1'),
    bed('c', 'f1', true),
    bed('d', 'f2'),
    bed('e', 'f2', true),
  ];
  const s = summarizeInventory(floors, beds, new Set(['a', 'd']));
  assert.equal(s.beds, 5);
  assert.equal(s.occupiedBeds, 2);
  assert.equal(s.outOfServiceBeds, 2);
  assert.equal(s.availableBeds, 1);
  assert.equal(s.occupiedBeds + s.availableBeds + s.outOfServiceBeds, s.beds);
  assert.equal(s.occupancyPercent, 40);
  assert.equal(s.occupiedOutOfService, 0);
});

test('inventory: an out-of-service bed is excluded from availability; an occupied one stays occupied and is flagged', () => {
  const beds = [bed('a', 'f1', true), bed('b', 'f1')];
  const s = summarizeInventory(floors, beds, new Set(['a']));
  assert.equal(s.occupiedBeds, 1);
  assert.equal(s.outOfServiceBeds, 0); // counted once, as occupied
  assert.equal(s.availableBeds, 1);
  assert.equal(s.occupiedOutOfService, 1);
  assert.equal(s.occupiedBeds + s.availableBeds + s.outOfServiceBeds, s.beds);
});

test('inventory: floors are ordered by ordinal, include empty floors, and add up to the totals', () => {
  const beds = [bed('a', 'f1'), bed('b', 'f2', true), bed('c', 'f2')];
  const s = summarizeInventory(floors, beds, new Set(['c']));
  assert.deepEqual(
    s.byFloor.map((f) => [f.label, f.beds, f.occupiedBeds, f.availableBeds, f.outOfServiceBeds]),
    [
      ['First', 1, 0, 1, 0],
      ['Second', 2, 1, 0, 1],
      ['Empty', 0, 0, 0, 0],
    ],
  );
  for (const key of ['beds', 'occupiedBeds', 'availableBeds', 'outOfServiceBeds'] as const) {
    assert.equal(
      s.byFloor.reduce((sum, f) => sum + f[key], 0),
      s[key],
      key,
    );
  }
});

test('inventory: an empty property has zeros and no division by zero', () => {
  const s = summarizeInventory([], [], new Set());
  assert.deepEqual(
    [s.beds, s.occupiedBeds, s.availableBeds, s.outOfServiceBeds, s.occupancyPercent],
    [0, 0, 0, 0, 0],
  );
  assert.deepEqual(s.byFloor, []);
});

test('inventory: a stay on a bed that is not a live bed of the property does not count as occupied', () => {
  const s = summarizeInventory(floors, [bed('a', 'f1')], new Set(['elsewhere']));
  assert.equal(s.occupiedBeds, 0);
  assert.equal(s.availableBeds, 1);
});

// ------------------------------------------------------------------------------------------------ gating

test('gating: both existing roles hold every section permission, an unknown role holds none', () => {
  for (const role of ['OWNER', 'PROPERTY_MANAGER']) {
    const gates = computeGates((p) => roleHasPermission(role, p));
    assert.deepEqual(gates.access, {
      tenants: true,
      upcomingCheckIns: true,
      recentAdmissions: true,
      bookings: true,
      finance: true,
      activity: true,
    });
  }
  const none = computeGates((p) => roleHasPermission('STAFF', p));
  assert.deepEqual(none.access, {
    tenants: false,
    upcomingCheckIns: false,
    recentAdmissions: false,
    bookings: false,
    finance: false,
    activity: false,
  });
});

const only = (...granted: Permission[]) => computeGates((p) => granted.includes(p));

test('gating: tenants need check-in AND resident read; each sub-field needs its own permission', () => {
  assert.equal(only('checkin.read').access.tenants, false);
  assert.equal(only('resident.read').access.tenants, false);
  assert.equal(only('checkin.read', 'resident.read').access.tenants, true);
  const tenantsOnly = only('checkin.read', 'resident.read').access;
  assert.equal(tenantsOnly.upcomingCheckIns, false); // needs booking.read
  assert.equal(tenantsOnly.recentAdmissions, false); // needs admission.read
  assert.equal(only('checkin.read', 'resident.read', 'booking.read').access.upcomingCheckIns, true);
  assert.equal(
    only('checkin.read', 'resident.read', 'admission.read').access.recentAdmissions,
    true,
  );
  // booking.read alone opens the bookings section but not the tenant sub-field (the tenant section is closed)
  assert.equal(only('booking.read').access.bookings, true);
  assert.equal(only('booking.read').access.upcomingCheckIns, false);
});

test('gating: finance follows finance.read alone; activity is open when any source permission is held', () => {
  assert.equal(only('finance.read').access.finance, true);
  assert.equal(only('inventory.read').access.finance, false);
  assert.equal(only('inventory.read').access.activity, false);
  for (const permission of [
    'booking.read',
    'admission.read',
    'checkin.read',
    'finance.read',
  ] as const) {
    assert.equal(only(permission).access.activity, true, permission);
  }
  assert.deepEqual(only('admission.read').sources, {
    booking: false,
    admission: true,
    checkin: false,
    finance: false,
  });
});

test('gating only uses permission constants that exist', () => {
  for (const permission of [
    'checkin.read',
    'resident.read',
    'booking.read',
    'admission.read',
    'finance.read',
    'inventory.read',
  ]) {
    assert.ok((PERMISSIONS as readonly string[]).includes(permission), permission);
  }
});

// ------------------------------------------------------------------------------------------------ activity

const event = (kind: ActivityItem['kind'], occurredAt: string, refId: string): ActivityItem => ({
  kind,
  occurredAt,
  timeBasis:
    kind === 'booking_created' || kind === 'admission_recorded' ? 'RECORD_CREATED' : 'EVENT',
  refId,
  residentId: 'r',
  residentName: 'Test Resident',
  bedId: null,
  bedLabel: null,
  roomLabel: null,
  amount: null,
  reversed: null,
});

test('activity: newest first, ties broken by kind then id, capped at ten', () => {
  const items = [
    event('check_in', '2026-11-10T00:00:00.000Z', 'b'),
    event('booking_created', '2026-11-10T00:00:00.000Z', 'z'),
    event('check_in', '2026-11-10T00:00:00.000Z', 'a'),
    event('payment_received', '2026-11-12T00:00:00.000Z', 'p'),
  ];
  assert.deepEqual(
    mergeActivity(items).map((i) => `${i.kind}:${i.refId}`),
    ['payment_received:p', 'booking_created:z', 'check_in:a', 'check_in:b'],
  );
  const many = Array.from({ length: 25 }, (_, i) =>
    event('check_in', `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, `id${i}`),
  );
  const merged = mergeActivity(many);
  assert.equal(merged.length, DASHBOARD_LIST_CAP);
  assert.equal(merged[0]!.refId, 'id24');
});

test('activity: record-creation events and business-time events carry their time basis', () => {
  assert.equal(
    event('admission_recorded', '2026-11-10T00:00:00.000Z', 'a').timeBasis,
    'RECORD_CREATED',
  );
  assert.equal(
    event('booking_created', '2026-11-10T00:00:00.000Z', 'a').timeBasis,
    'RECORD_CREATED',
  );
  for (const kind of ['check_in', 'check_out', 'payment_received'] as const) {
    assert.equal(event(kind, '2026-11-10T00:00:00.000Z', 'a').timeBasis, 'EVENT');
  }
});

test('helpers: full names and IST date keys', () => {
  assert.equal(fullName({ firstName: 'Asha', lastName: 'Rao' }), 'Asha Rao');
  assert.equal(fullName({ firstName: 'Asha', lastName: '' }), 'Asha');
  assert.equal(istDateKey(new Date('2026-11-14T18:30:00Z')), '2026-11-15');
  assert.equal(istDateKey(new Date('2026-11-14T18:29:59Z')), '2026-11-14');
});
