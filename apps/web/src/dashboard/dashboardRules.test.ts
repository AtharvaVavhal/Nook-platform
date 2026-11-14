import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityItem, Inventory } from './dashboardApi';
import {
  ADMISSION_STATUS_LABELS,
  DASHBOARD_DAYS,
  MONTHS_BACK,
  PAYMENT_METHOD_LABELS,
  activityText,
  addDaysKey,
  anomalyMessages,
  formatInstantIst,
  isEmptyProperty,
  monthOptions,
  occupancyBarDescription,
  occupancySegments,
  occupancySummary,
  percentText,
  placeText,
  plural,
  recentWindowText,
  shiftMonthKey,
  showingLabel,
  upcomingWindowText,
} from './dashboardRules';

const inventory = (over: Partial<Inventory> = {}): Inventory => ({
  rooms: 25,
  beds: 100,
  occupiedBeds: 62,
  availableBeds: 35,
  outOfServiceBeds: 3,
  occupancyPercent: 62,
  byFloor: [],
  anomalies: { occupiedOutOfService: 0, stayNeedsReview: 0 },
  ...over,
});

test('the first version asks for 14 days and offers the current month and five before it', () => {
  assert.equal(DASHBOARD_DAYS, 14);
  assert.equal(MONTHS_BACK, 5);
});

test('month choices: newest first, the current month and the five before it, across a year boundary', () => {
  assert.deepEqual(
    monthOptions('2026-11').map((o) => o.value),
    ['2026-11', '2026-10', '2026-09', '2026-08', '2026-07', '2026-06'],
  );
  assert.deepEqual(
    monthOptions('2026-02').map((o) => o.value),
    ['2026-02', '2026-01', '2025-12', '2025-11', '2025-10', '2025-09'],
  );
  assert.equal(monthOptions('2026-11')[0]!.label, 'November 2026');
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
});

test('occupancy is worded with its denominator, never as a bare percentage', () => {
  assert.equal(occupancySummary(inventory()), '62 of 100 beds occupied');
  assert.equal(occupancySummary(inventory({ occupiedBeds: 1, beds: 1 })), '1 of 1 bed occupied');
  assert.equal(percentText(62), '62%');
  assert.equal(percentText(66.7), '66.7%');
  assert.equal(percentText(0), '0%');
});

test('the occupancy bar splits the beds and has a text equivalent', () => {
  const segments = occupancySegments(inventory());
  assert.deepEqual(
    segments.map((s) => [s.key, s.count, s.percent]),
    [
      ['occupied', 62, 62],
      ['available', 35, 35],
      ['outOfService', 3, 3],
    ],
  );
  assert.equal(
    segments.reduce((sum, s) => sum + s.percent, 0),
    100,
  );
  assert.equal(
    occupancyBarDescription(inventory()),
    '62 occupied, 35 available and 3 out of service, of 100 beds',
  );
});

test('an empty property has zero-width segments, no division by zero, and is recognised as empty', () => {
  const empty = inventory({
    rooms: 0,
    beds: 0,
    occupiedBeds: 0,
    availableBeds: 0,
    outOfServiceBeds: 0,
    occupancyPercent: 0,
  });
  assert.ok(occupancySegments(empty).every((s) => s.percent === 0));
  assert.equal(isEmptyProperty(empty), true);
  assert.equal(isEmptyProperty(inventory()), false);
  assert.equal(
    isEmptyProperty(inventory({ rooms: 3, beds: 0 })),
    false,
    'rooms without beds are not an empty property',
  );
});

test('anomalies are explained, singular and plural, and never hidden', () => {
  assert.deepEqual(anomalyMessages(inventory()), []);
  const one = anomalyMessages(
    inventory({ anomalies: { occupiedOutOfService: 1, stayNeedsReview: 1 } }),
  );
  assert.equal(one.length, 2);
  assert.match(one[0]!, /1 occupied bed is marked out of service/);
  assert.match(
    one[1]!,
    /1 active stay has an inconsistent bed history and is not counted as occupied/,
  );
  const many = anomalyMessages(
    inventory({ anomalies: { occupiedOutOfService: 2, stayNeedsReview: 3 } }),
  );
  assert.match(many[0]!, /2 occupied beds are marked out of service/);
  assert.match(many[1]!, /3 active stays have an inconsistent bed history and are not counted/);
});

test('a capped list says how many it hides', () => {
  assert.equal(showingLabel(14, 10), 'Showing 10 of 14');
  assert.equal(showingLabel(10, 10), null);
  assert.equal(showingLabel(0, 0), null);
});

test('window wording shows the inclusive last day of the half-open upcoming window', () => {
  const windows = {
    upcoming: { from: '2026-11-14', toExclusive: '2026-11-28' },
    recent: { from: '2026-11-01', to: '2026-11-14' },
  };
  assert.equal(upcomingWindowText(windows), '14 Nov to 27 Nov');
  assert.equal(recentWindowText(windows), '1 Nov to 14 Nov');
  assert.equal(addDaysKey('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysKey('2026-03-01', -1), '2026-02-28');
});

test('instants are shown in Asia/Kolkata time whatever the browser zone is', () => {
  assert.match(formatInstantIst('2026-11-14T18:29:59Z'), /14 Nov 2026/);
  assert.match(formatInstantIst('2026-11-14T18:30:00Z'), /15 Nov 2026/);
  assert.match(formatInstantIst('2026-11-14T10:00:00Z'), /3:30\s?pm/i);
  assert.equal(formatInstantIst('not a date'), '—');
});

const item = (kind: ActivityItem['kind'], timeBasis: ActivityItem['timeBasis']): ActivityItem => ({
  kind,
  occurredAt: '2026-11-12T03:00:00.000Z',
  timeBasis,
  refId: 'x',
  residentId: 'r',
  residentName: 'Test Resident',
  bedId: null,
  bedLabel: null,
  roomLabel: null,
  amount: null,
  reversed: null,
});

test('R7: booking and admission activity is worded and captioned as a record-creation time', () => {
  const admission = activityText(item('admission_recorded', 'RECORD_CREATED'));
  assert.equal(admission.title, 'Admission record created');
  assert.equal(admission.timeLabel, 'Recorded');
  const booking = activityText(item('booking_created', 'RECORD_CREATED'));
  assert.equal(booking.title, 'Booking record created');
  assert.equal(booking.timeLabel, 'Recorded');
});

test('R7: an admission record is never worded as an admission date or as being admitted', () => {
  const text = activityText(item('admission_recorded', 'RECORD_CREATED'));
  const all = `${text.title} ${text.timeLabel}`;
  assert.doesNotMatch(all, /admitted|admission date|admitted on/i);
});

test('business-time events are worded as events with their own captions', () => {
  assert.deepEqual(
    (['check_in', 'check_out', 'payment_received'] as const).map((k) => {
      const t = activityText(item(k, 'EVENT'));
      return [t.title, t.timeLabel];
    }),
    [
      ['Checked in', 'Check-in time'],
      ['Checked out', 'Check-out time'],
      ['Payment received', 'Received'],
    ],
  );
  assert.ok(activityText(item('check_in', 'EVENT')).time.includes('Nov 2026'));
});

test('labels and place text', () => {
  assert.equal(PAYMENT_METHOD_LABELS.BANK_TRANSFER, 'Bank transfer');
  assert.equal(ADMISSION_STATUS_LABELS.NONE, 'No admission yet');
  assert.equal(
    placeText({ floorLabel: 'Floor 1', roomLabel: '101', bedLabel: '2' }),
    'Floor 1 · Room 101 · Bed 2',
  );
  assert.equal(plural(1, 'invoice'), '1 invoice');
  assert.equal(plural(3, 'invoice'), '3 invoices');
  assert.equal(plural(0, 'day'), '0 days');
});
