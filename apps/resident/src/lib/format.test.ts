import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DASH,
  formatBillingPeriod,
  formatDate,
  formatDateTime,
  formatDuration,
  formatInr,
  greeting,
  initials,
  isZeroAmount,
  methodLabel,
} from './format.js';

test('money uses Indian grouping and exact two-decimal strings, with no float arithmetic', () => {
  assert.equal(formatInr('8000.00'), '₹8,000.00');
  assert.equal(formatInr('0.00'), '₹0.00');
  assert.equal(formatInr('123456.50'), '₹1,23,456.50');
  assert.equal(formatInr('12345678.99'), '₹1,23,45,678.99');
  assert.equal(formatInr('999'), '₹999.00');
  assert.equal(formatInr('5.5'), '₹5.50');
  assert.equal(formatInr('-250.00'), '-₹250.00');
  // precision beyond float range is preserved because nothing is converted to a number
  assert.equal(formatInr('90071992547409930.10'), '₹90,07,19,92,54,74,09,930.10');
});

test('an unreadable amount is an em dash, never an invented figure', () => {
  for (const bad of [null, undefined, '', 'abc', '12.345', '1e5', 'NaN', '₹1'])
    assert.equal(formatInr(bad as never), DASH);
  assert.equal(isZeroAmount('0.00'), true);
  assert.equal(isZeroAmount('0'), true);
  assert.equal(isZeroAmount('0.01'), false);
  assert.equal(isZeroAmount(null), false);
});

test('dates: a date-only value never shifts with the time zone; a timestamp is shown in India time', () => {
  assert.equal(formatDate('2026-11-05'), '5 Nov 2026');
  assert.equal(formatDate('2026-12-31'), '31 Dec 2026');
  assert.equal(formatDate('2026-11-05T20:00:00.000Z'), '6 Nov 2026'); // 01:30 IST next day
  assert.equal(formatDate('2026-11-05T05:00:00.000Z'), '5 Nov 2026');
  for (const bad of [null, undefined, '', 'not a date', '2026-13-40x'])
    assert.equal(formatDate(bad as never), DASH);
  assert.match(formatDateTime('2026-11-05T10:15:00.000Z'), /^5 Nov 2026, 3:45 PM$/);
  assert.equal(formatDateTime('nope'), DASH);
});

test('billing period: one month reads as the month, anything else as a range', () => {
  assert.equal(formatBillingPeriod('2026-11-01', '2026-11-30'), 'November 2026');
  assert.equal(formatBillingPeriod('2026-11-15', '2026-12-14'), '15 Nov 2026 – 14 Dec 2026');
  assert.equal(formatBillingPeriod(null, '2026-11-30'), DASH);
});

test('greeting, initials, countdown and payment method wording', () => {
  assert.deepEqual(
    [greeting(0), greeting(11), greeting(12), greeting(16), greeting(17), greeting(23)],
    [
      'Good morning',
      'Good morning',
      'Good afternoon',
      'Good afternoon',
      'Good evening',
      'Good evening',
    ],
  );
  assert.equal(initials('Asha Example'), 'AE');
  assert.equal(initials('  priya   k  rao '), 'PR');
  assert.equal(initials('Madonna'), 'M');
  assert.equal(initials(''), 'N');
  assert.equal(initials(null), 'N');
  assert.equal(formatDuration(30), '0:30');
  assert.equal(formatDuration(65.2), '1:06');
  assert.equal(formatDuration(-5), '0:00');
  assert.equal(methodLabel('BANK_TRANSFER'), 'Bank transfer');
  assert.equal(methodLabel('UPI'), 'UPI');
  assert.equal(methodLabel('CASH'), 'Cash');
  assert.equal(methodLabel('CARD_TAP'), 'Card tap');
  assert.equal(methodLabel(null), DASH);
});
