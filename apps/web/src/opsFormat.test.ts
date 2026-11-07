import assert from 'node:assert/strict';
import test from 'node:test';
import { isPastBookingEnd, istDateString } from './ops/opsFormat';

test('istDateString is the Asia/Kolkata calendar date whatever the machine time zone is', () => {
  assert.equal(istDateString('2026-10-31T18:29:00Z'), '2026-10-31');
  assert.equal(istDateString('2026-10-31T18:30:00Z'), '2026-11-01');
  assert.equal(istDateString(new Date('2026-12-31T19:00:00Z')), '2027-01-01');
});

test('a resident is past the booking on the exclusive end date itself', () => {
  const end = '2026-11-01T00:00:00.000Z'; // booking end date 1 Nov
  assert.equal(isPastBookingEnd(end, new Date('2026-10-31T18:29:00Z')), false); // still 31 Oct in India
  assert.equal(isPastBookingEnd(end, new Date('2026-10-31T18:30:00Z')), true); // 1 Nov in India
  assert.equal(isPastBookingEnd(end, new Date('2026-11-20T06:00:00Z')), true);
  assert.equal(
    isPastBookingEnd('2027-03-01T00:00:00.000Z', new Date('2026-11-20T06:00:00Z')),
    false,
  );
});

import { isMonthlyPrice } from './ops/opsFormat';

test('monthly rent: the form accepts exactly what the API accepts (0.01 to 99,999,999.99, two decimals)', () => {
  for (const ok of [
    '0.01',
    '1',
    '7500',
    '7500.5',
    '7500.50',
    '99999999.99',
    '99999999',
    ' 4200 ',
  ]) {
    assert.equal(isMonthlyPrice(ok), true, ok);
  }
  for (const bad of [
    '',
    '0',
    '0.00',
    '-5',
    'abc',
    '1e3',
    '12.345',
    '100000000',
    '100000000.00',
    '1234567890',
    '99999999.999',
    '7,500',
    '₹7500',
  ]) {
    assert.equal(isMonthlyPrice(bad), false, bad);
  }
});

import { suggestedAdmissionDate } from './ops/opsFormat';

test('admission date offered: today inside the booked period, else the first booked day', () => {
  const booking = { startDate: '2026-12-01T00:00:00.000Z', endDate: '2027-03-01T00:00:00.000Z' };
  assert.equal(suggestedAdmissionDate(booking, '2026-12-15'), '2026-12-15');
  assert.equal(suggestedAdmissionDate(booking, '2026-12-01'), '2026-12-01');
  assert.equal(suggestedAdmissionDate(booking, '2027-02-28'), '2027-02-28');
  assert.equal(suggestedAdmissionDate(booking, '2026-11-03'), '2026-12-01', 'a future booking');
  assert.equal(suggestedAdmissionDate(booking, '2027-03-01'), '2026-12-01', 'the end is exclusive');
  assert.equal(suggestedAdmissionDate(booking, '2027-06-01'), '2026-12-01', 'a past booking');
});
