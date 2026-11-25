import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountStatus,
  invoiceStatus,
  paymentStatus,
  rentStatus,
  residentStatus,
  stayStatus,
  upcomingStageLabel,
} from './status.js';

test('every status the API can send has plain wording and a tone', () => {
  assert.deepEqual(invoiceStatus('PAID'), { label: 'Paid', tone: 'success' });
  assert.deepEqual(invoiceStatus('ISSUED'), { label: 'Due', tone: 'accent' });
  assert.deepEqual(invoiceStatus('PARTIALLY_PAID'), { label: 'Partly paid', tone: 'warning' });
  assert.deepEqual(invoiceStatus('OVERDUE'), { label: 'Overdue', tone: 'danger' });
  assert.deepEqual(rentStatus('PAID_UP'), { label: 'Paid up', tone: 'success' });
  assert.deepEqual(rentStatus('NO_INVOICES'), { label: 'No invoices yet', tone: 'neutral' });
  assert.deepEqual(stayStatus('UNDER_REVIEW'), { label: 'Under review', tone: 'warning' });
  assert.deepEqual(stayStatus('UPCOMING'), { label: 'Upcoming', tone: 'accent' });
  assert.deepEqual(paymentStatus('REVERSED'), { label: 'Reversed', tone: 'neutral' });
  assert.deepEqual(accountStatus('ACTIVE'), { label: 'Active', tone: 'success' });
  assert.deepEqual(residentStatus('ACTIVE'), { label: 'Active', tone: 'success' });
  assert.equal(upcomingStageLabel('ADMITTED_AWAITING_CHECK_IN'), 'Ready for check-in');
});

test('an unknown status is shown neutrally in plain words, not hidden or mistaken for a known one', () => {
  assert.deepEqual(invoiceStatus('WRITTEN_OFF'), { label: 'Written off', tone: 'neutral' });
  assert.equal(upcomingStageLabel('SOMETHING_NEW'), 'Something new');
});
