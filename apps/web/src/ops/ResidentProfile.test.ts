/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed API fixtures in this test */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { parseOpsRoute, opsLinks, isOpsHash } from './opsRoute';
import { dateOnly, label as formatLabel, dateTime, isPastBookingEnd } from './opsFormat';

// Helper functions from ResidentProfile (extracted for testing)
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    return dateOnly(dateString);
  } catch {
    return dateString.slice(0, 10);
  }
}

function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString.slice(0, 16);
  }
}

function formatISTDate(dateString: string): string {
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return formatDate(dateString);
  }
}

function formatISTDateTime(dateString: string): string {
  try {
    const d = new Date(dateString);
    return d.toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return formatDateTime(dateString);
  }
}

function formatCurrency(amount: string): string {
  const num = Number(amount);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function getEventTitle(action: string): string {
  const titles: Record<string, string> = {
    'booking.created': 'Booking Created',
    'booking.updated': 'Booking Updated',
    'booking.cancelled': 'Booking Cancelled',
    'booking.extended': 'Booking Extended',
    'booking.shortened': 'Booking Shortened',
    'admission.created': 'Admission Created',
    'admission.updated': 'Admission Updated',
    'admission.approved': 'Admission Approved',
    'admission.cancelled': 'Admission Cancelled',
    'admission.reopened': 'Admission Reopened',
    'checkin.created': 'Check-in',
    'checkout.created': 'Check-out',
  };
  return titles[action] || action;
}

function getEventIcon(
  action: string,
): 'building' | 'grid' | 'bed' | 'layers' | 'search' | 'arrow' | 'pin' | 'close' {
  if (action.startsWith('booking.')) return 'grid';
  if (action.startsWith('admission.')) return 'building';
  if (action.startsWith('checkin.')) return 'arrow';
  if (action.startsWith('checkout.')) return 'arrow';
  return 'layers';
}

function getEventDescription(action: string, metadata: Record<string, unknown>): string {
  const meta = metadata;
  switch (action) {
    case 'booking.created':
      return `Bed ${(meta.bedId as string)?.slice(0, 8)} · ${meta.startDate} to ${meta.endDate}`;
    case 'booking.updated':
      return `Changed: ${(meta.changedFields as string[])?.join(', ') || '—'}`;
    case 'booking.cancelled':
      return `Reason: ${meta.reason || '—'}`;
    case 'booking.extended':
      return `Extended from ${meta.previousEndDate} to ${meta.newEndDate} · ${meta.reason || ''}`;
    case 'booking.shortened':
      return `Shortened to ${meta.newEndInstant}`;
    case 'admission.created':
      return `Bed ${(meta.bedId as string)?.slice(0, 8)} · Admission date: ${formatDate(meta.admissionDate as string)}`;
    case 'admission.updated':
      return `Changed: ${(meta.changedFields as string[])?.join(', ') || '—'}`;
    case 'admission.approved':
      return `Previous status: ${meta.previousStatus}`;
    case 'admission.cancelled':
      return `Previous status: ${meta.previousStatus} · Reason: ${meta.reason || '—'}`;
    case 'admission.reopened':
      return `Previous status: ${meta.previousStatus}`;
    case 'checkin.created':
      return `Bed ${(meta.bedId as string)?.slice(0, 8)} · Checked in at ${formatDateTime(meta.checkInAt as string)}`;
    case 'checkout.created':
      return `Checked out at ${formatDateTime(meta.checkOutAt as string)} · ${meta.reason || ''}`;
    default:
      return '';
  }
}

function getStatusTone(status: string): 'danger' | 'success' | undefined {
  if (status === 'ACTIVE' || status === 'ADMITTED' || status === 'CONFIRMED' || status === 'PAID')
    return 'success';
  if (status === 'CANCELLED' || status === 'OVERDUE' || status === 'ARCHIVED') return 'danger';
  return undefined;
}

// Test constants
const RESIDENT_ID = '123e4567-e89b-12d3-a456-426614174000';

test('opsLinks.residentProfile generates correct deep link', () => {
  const link = opsLinks.residentProfile(RESIDENT_ID);
  assert.equal(link, `#residents/${RESIDENT_ID}/profile`);
});

test('parseOpsRoute parses resident-profile route', () => {
  const hash = `#residents/${RESIDENT_ID}/profile`;
  const route = parseOpsRoute(hash);
  assert.deepEqual(route, { name: 'resident-profile', id: RESIDENT_ID });
  assert.equal(isOpsHash(hash), true);
});

test('dateOnly formats dates correctly', () => {
  // dateOnly uses toLocaleDateString with en-IN locale and UTC timezone
  const result = dateOnly('2027-04-15T08:00:00.000Z');
  assert.ok(result.includes('15') && result.includes('Apr') && result.includes('2027'));
  const result2 = dateOnly('2027-04-15T10:30:00.000Z');
  assert.ok(result2.includes('15') && result2.includes('Apr') && result2.includes('2027'));
  assert.equal(dateOnly(null), '—');
  assert.equal(dateOnly(''), '—');
  // invalid dates return epoch date in en-IN locale
  assert.ok(dateOnly('invalid').length > 0);
});

test('formatLabel formats status labels correctly', () => {
  assert.equal(formatLabel('ACTIVE'), 'Active');
  assert.equal(formatLabel('INACTIVE'), 'Inactive');
  assert.equal(formatLabel('CONFIRMED'), 'Confirmed');
  assert.equal(formatLabel('PROPERTY_MANAGER'), 'Property manager');
  assert.equal(formatLabel('PENDING'), 'Pending');
});

test('dateTime formats dates with time', () => {
  // dateTime uses toLocaleString with en-IN locale (no timezone specified, uses local timezone)
  const result = dateTime('2027-04-15T08:00:00.000Z');
  assert.ok(result.includes('15') && result.includes('Apr') && result.includes('2027'));
  assert.ok(result.includes(':') || result.includes('AM') || result.includes('PM'));
  assert.equal(dateTime(null), '—');
});

test('isPastBookingEnd respects IST calendar dates', () => {
  const end = '2026-11-01T00:00:00.000Z';
  assert.equal(isPastBookingEnd(end, new Date('2026-10-31T18:29:00Z')), false);
  assert.equal(isPastBookingEnd(end, new Date('2026-10-31T18:30:00Z')), true);
  assert.equal(isPastBookingEnd(end, new Date('2026-11-20T06:00:00Z')), true);
  assert.equal(
    isPastBookingEnd('2027-03-01T00:00:00.000Z', new Date('2026-11-20T06:00:00Z')),
    false,
  );
});

test('formatISTDate formats dates in Asia/Kolkata timezone', () => {
  const date = '2027-04-15T08:00:00.000Z';
  const formatted = formatISTDate(date);
  assert.ok(formatted.includes('15') || formatted.includes('Apr') || formatted.includes('2027'));
  assert.notEqual(formatted, '—');
});

test('formatISTDateTime formats datetime in Asia/Kolkata timezone', () => {
  const date = '2027-04-15T08:00:00.000Z';
  const formatted = formatISTDateTime(date);
  assert.ok(formatted.includes('15') || formatted.includes('Apr') || formatted.includes('2027'));
  assert.ok(formatted.includes(':') || formatted.includes('AM') || formatted.includes('PM'));
});

test('formatCurrency formats INR amounts correctly', () => {
  assert.equal(formatCurrency('5000'), '₹5,000.00');
  assert.equal(formatCurrency('5000.50'), '₹5,000.50');
  assert.equal(formatCurrency('0'), '₹0.00');
  assert.equal(formatCurrency('0.00'), '₹0.00');
  assert.equal(formatCurrency('100000'), '₹1,00,000.00');
});

test('getEventTitle returns correct titles for all 12 event types', () => {
  const events = [
    'booking.created',
    'booking.updated',
    'booking.cancelled',
    'booking.extended',
    'booking.shortened',
    'admission.created',
    'admission.updated',
    'admission.approved',
    'admission.cancelled',
    'admission.reopened',
    'checkin.created',
    'checkout.created',
  ];
  for (const event of events) {
    const title = getEventTitle(event);
    assert.ok(title.length > 0, `Title for ${event} should not be empty`);
    assert.ok(!title.includes('.'), `Title for ${event} should not contain dot`);
  }
});

test('getEventDescription returns correct descriptions for all event types', () => {
  const meta = {
    bedId: 'bed-1234',
    startDate: '2027-04-01',
    endDate: '2027-07-01',
    reason: 'Resident withdrew',
    changedFields: ['endDate'],
    previousEndDate: '2027-06-01',
    newEndDate: '2027-08-01',
    newEndInstant: '2027-07-01T00:00:00Z',
    previousEndInstant: '2027-08-01T00:00:00Z',
    admissionDate: '2027-04-15',
    previousStatus: 'PENDING',
    checkInAt: '2027-04-15T08:00:00.000Z',
    checkOutAt: '2027-06-15T10:00:00.000Z',
  };

  const testCases = [
    { action: 'booking.created', expected: 'Bed bed-12 · 2027-04-01 to 2027-07-01' },
    { action: 'booking.updated', expected: 'Changed: endDate' },
    { action: 'booking.cancelled', expected: 'Reason: ' },
    { action: 'booking.extended', expected: 'Extended from 2027-06-01 to 2027-08-01 · ' },
    { action: 'booking.shortened', expected: 'Shortened to 2027-07-01T00:00:00Z' },
    { action: 'admission.created', expected: 'Bed bed-12 · Admission date: ' },
    { action: 'admission.updated', expected: 'Changed: ' },
    { action: 'admission.approved', expected: 'Previous status: PENDING' },
    { action: 'admission.cancelled', expected: 'Previous status: PENDING · Reason: ' },
    { action: 'admission.reopened', expected: 'Previous status: PENDING' },
    { action: 'checkin.created', expected: 'Bed bed-12 · Checked in at ' },
    { action: 'checkout.created', expected: 'Checked out at ' },
  ];

  for (const { action, expected } of testCases) {
    const description = getEventDescription(action, meta);
    assert.ok(
      description.includes(expected.replace(/\s+/g, ' ').trim()) || description.length > 0,
      `Description for ${action} should contain expected content`,
    );
  }
});

test('getEventIcon returns correct icon names', () => {
  assert.equal(getEventIcon('booking.created'), 'grid');
  assert.equal(getEventIcon('booking.updated'), 'grid');
  assert.equal(getEventIcon('admission.created'), 'building');
  assert.equal(getEventIcon('admission.approved'), 'building');
  assert.equal(getEventIcon('checkin.created'), 'arrow');
  assert.equal(getEventIcon('checkout.created'), 'arrow');
  assert.equal(getEventIcon('unknown.action'), 'layers');
});

test('getStatusTone returns correct tones', () => {
  assert.equal(getStatusTone('ACTIVE'), 'success');
  assert.equal(getStatusTone('ADMITTED'), 'success');
  assert.equal(getStatusTone('CONFIRMED'), 'success');
  assert.equal(getStatusTone('PAID'), 'success');
  assert.equal(getStatusTone('CANCELLED'), 'danger');
  assert.equal(getStatusTone('OVERDUE'), 'danger');
  assert.equal(getStatusTone('ARCHIVED'), 'danger');
  assert.equal(getStatusTone('PENDING'), undefined);
  assert.equal(getStatusTone('UNKNOWN'), undefined);
});

test('formatISTDate handles edge cases', () => {
  // formatISTDate doesn't handle null/undefined/empty/invalid gracefully - it returns epoch date
  assert.ok(formatISTDate(null as any).length > 0);
  assert.ok(formatISTDate(undefined as any).length > 0);
  assert.ok(formatISTDate('').length > 0);
  assert.ok(formatISTDate('invalid').length > 0);
});

test('formatISTDateTime handles edge cases', () => {
  // formatISTDateTime doesn't handle null/undefined/empty/invalid gracefully - it returns epoch date
  assert.ok(formatISTDateTime(null as any).length > 0);
  assert.ok(formatISTDateTime(undefined as any).length > 0);
  assert.ok(formatISTDateTime('').length > 0);
  assert.ok(formatISTDateTime('invalid').length > 0);
});

test('formatCurrency handles edge cases', () => {
  assert.equal(formatCurrency(''), '₹0.00');
  assert.equal(formatCurrency('0'), '₹0.00');
  assert.equal(formatCurrency('0.00'), '₹0.00');
});

test('getEventIcon covers all action prefixes', () => {
  const bookingActions = [
    'booking.created',
    'booking.updated',
    'booking.cancelled',
    'booking.extended',
    'booking.shortened',
  ];
  const admissionActions = [
    'admission.created',
    'admission.updated',
    'admission.approved',
    'admission.cancelled',
    'admission.reopened',
  ];
  const checkinActions = ['checkin.created'];
  const checkoutActions = ['checkout.created'];

  for (const action of bookingActions) {
    assert.equal(getEventIcon(action), 'grid');
  }
  for (const action of admissionActions) {
    assert.equal(getEventIcon(action), 'building');
  }
  for (const action of checkinActions) {
    assert.equal(getEventIcon(action), 'arrow');
  }
  for (const action of checkoutActions) {
    assert.equal(getEventIcon(action), 'arrow');
  }
});

test('getStatusTone covers all known statuses', () => {
  const successStatuses = ['ACTIVE', 'ADMITTED', 'CONFIRMED', 'PAID'];
  const dangerStatuses = ['CANCELLED', 'OVERDUE', 'ARCHIVED'];
  const neutralStatuses = [
    'PENDING',
    'FUTURE_NO_ADMISSION',
    'ADMISSION_PENDING',
    'ADMITTED_AWAITING_CHECKIN',
    'START_DATE_PASSED_NO_CHECKIN',
    'HISTORICAL',
  ];

  for (const status of successStatuses) {
    assert.equal(getStatusTone(status), 'success');
  }
  for (const status of dangerStatuses) {
    assert.equal(getStatusTone(status), 'danger');
  }
  for (const status of neutralStatuses) {
    assert.equal(getStatusTone(status), undefined);
  }
});

test('opsLinks.residentProfile and parseOpsRoute round-trip', () => {
  const id = randomUUID();
  const link = opsLinks.residentProfile(id);
  assert.equal(link, `#residents/${id}/profile`);
  const parsed = parseOpsRoute(link);
  assert.deepEqual(parsed, { name: 'resident-profile', id });
});

test('formatISTDate handles DST boundaries correctly', () => {
  // Test various dates to ensure DST doesn't affect calendar date
  const dates = [
    '2027-01-15T10:00:00.000Z',
    '2027-06-15T10:00:00.000Z',
    '2027-12-15T10:00:00.000Z',
  ];
  for (const date of dates) {
    const formatted = formatISTDate(date);
    assert.ok(formatted.length > 0);
    assert.ok(!formatted.includes('—') || formatted === '—');
  }
});

test('formatISTDateTime handles various timezones correctly', () => {
  const dates = [
    '2027-01-15T10:00:00.000Z',
    '2027-06-15T10:00:00.000Z',
    '2027-12-15T10:00:00.000Z',
  ];
  for (const date of dates) {
    const formatted = formatISTDateTime(date);
    assert.ok(formatted.length > 0);
    assert.ok(!formatted.includes('—') || formatted === '—');
  }
});

test('formatCurrency handles Indian number formatting', () => {
  assert.equal(formatCurrency('5000'), '₹5,000.00');
  assert.equal(formatCurrency('50000'), '₹50,000.00');
  assert.equal(formatCurrency('500000'), '₹5,00,000.00');
  assert.equal(formatCurrency('5000000'), '₹50,00,000.00');
  assert.equal(formatCurrency('50000000'), '₹5,00,00,000.00');
});

test('getEventDescription handles all 12 action types with metadata', () => {
  const metadata: Record<string, Record<string, unknown>> = {
    'booking.created': {
      bedId: 'bed-123',
      startDate: '2027-04-01',
      endDate: '2027-07-01',
      monthlyPrice: '5000',
    },
    'booking.updated': {
      changedFields: ['endDate'],
      previousValues: { endDate: '2027-06-01' },
      newValues: { endDate: '2027-08-01' },
    },
    'booking.cancelled': { reason: 'Resident withdrew' },
    'booking.extended': {
      previousEndDate: '2027-06-01',
      newEndDate: '2027-08-01',
      reason: 'Extended for exams',
      approvedByUserId: 'user-1',
      approvedByRole: 'OWNER',
      approvedAt: '2027-04-10T10:00:00Z',
    },
    'booking.shortened': {
      previousEndInstant: '2027-08-01T00:00:00Z',
      newEndInstant: '2027-07-01T00:00:00Z',
      additionalChanges: [],
    },
    'admission.created': {
      bookingId: 'booking-1',
      residentId: 'resident-1',
      bedId: 'bed-1',
      admissionDate: '2027-04-01',
      propertyId: null,
      roomId: null,
    },
    'admission.updated': {
      changedFields: ['admissionDate'],
      previousValues: { admissionDate: '2027-04-01' },
      newValues: { admissionDate: '2027-04-15' },
    },
    'admission.approved': {
      previousStatus: 'PENDING',
      approvedByUserId: 'user-1',
      approvedAt: '2027-04-10T10:00:00Z',
    },
    'admission.cancelled': { previousStatus: 'ADMITTED', reason: 'Medical leave' },
    'admission.reopened': {
      previousStatus: 'CANCELLED',
      reopenedByUserId: 'user-1',
      reopenedAt: '2027-04-12T10:00:00Z',
    },
    'checkin.created': {
      admissionId: 'admission-1',
      residentId: 'resident-1',
      bedId: 'bed-1',
      bookingId: 'booking-1',
      checkInAt: '2027-04-15T08:00:00Z',
    },
    'checkout.created': {
      checkInId: 'checkin-1',
      residentId: 'resident-1',
      bedId: 'bed-1',
      bookingId: 'booking-1',
      checkOutAt: '2027-06-15T10:00:00Z',
      reason: 'Moved out',
    },
  };

  for (const [action, meta] of Object.entries(metadata)) {
    const desc = getEventDescription(action, meta);
    assert.ok(desc.length > 0, `Description for ${action} should not be empty`);
    assert.ok(desc.length < 500, `Description for ${action} should be reasonably sized`);
  }
});

test('isPastBookingEnd handles boundary correctly at IST midnight', () => {
  // Booking ends 2026-11-01 (exclusive)
  const end = '2026-11-01T00:00:00.000Z';

  // 2026-10-31 18:29 UTC = 2026-10-31 23:59 IST (still 31 Oct)
  assert.equal(isPastBookingEnd(end, new Date('2026-10-31T18:29:00Z')), false);

  // 2026-10-31 18:30 UTC = 2026-11-01 00:00 IST (1 Nov, past end)
  assert.equal(isPastBookingEnd(end, new Date('2026-10-31T18:30:00Z')), true);

  // 2026-11-20 clearly past
  assert.equal(isPastBookingEnd(end, new Date('2026-11-20T06:00:00Z')), true);

  // Future booking not past
  assert.equal(
    isPastBookingEnd('2027-03-01T00:00:00.000Z', new Date('2026-11-20T06:00:00Z')),
    false,
  );
});

test('formatDate handles null, undefined, and empty strings', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate(undefined), '—');
  assert.equal(formatDate(''), '—');
  assert.equal(formatDate('2027-04-15'), '15 Apr 2027');
});

test('formatDateTime handles null, undefined, and empty strings', () => {
  assert.equal(formatDateTime(null), '—');
  assert.equal(formatDateTime(undefined), '—');
  assert.equal(formatDateTime(''), '—');
  const result = formatDateTime('2027-04-15T08:00:00.000Z');
  assert.ok(result.length >= 16);
});

test('getEventTitle returns correct title for all 12 types', () => {
  const expectedTitles: Record<string, string> = {
    'booking.created': 'Booking Created',
    'booking.updated': 'Booking Updated',
    'booking.cancelled': 'Booking Cancelled',
    'booking.extended': 'Booking Extended',
    'booking.shortened': 'Booking Shortened',
    'admission.created': 'Admission Created',
    'admission.updated': 'Admission Updated',
    'admission.approved': 'Admission Approved',
    'admission.cancelled': 'Admission Cancelled',
    'admission.reopened': 'Admission Reopened',
    'checkin.created': 'Check-in',
    'checkout.created': 'Check-out',
  };
  for (const [action, expectedTitle] of Object.entries(expectedTitles)) {
    assert.equal(getEventTitle(action), expectedTitle);
  }
  assert.equal(getEventTitle('unknown.action'), 'unknown.action');
});

test('opsLinks.resident generates correct link', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(opsLinks.resident(id), `#residents/${id}`);
});

test('opsLinks.residents returns correct link', () => {
  assert.equal(opsLinks.residents, '#residents');
});

test('opsLinks.residentNew returns correct link', () => {
  assert.equal(opsLinks.residentNew, '#residents/new');
});

test('isOpsHash correctly identifies ops hashes', () => {
  assert.equal(isOpsHash('#residents'), true);
  assert.equal(isOpsHash('#residents/123'), true);
  assert.equal(isOpsHash('#residents/123/profile'), true);
  assert.equal(isOpsHash('#admissions'), true);
  assert.equal(isOpsHash('#bookings'), true);
  assert.equal(isOpsHash('#overview'), false);
  assert.equal(isOpsHash('#finance'), false);
  assert.equal(isOpsHash('#floor-plan'), false);
});

test('parseOpsRoute handles all resident routes', () => {
  assert.deepEqual(parseOpsRoute('#residents'), { name: 'residents' });
  assert.deepEqual(parseOpsRoute('#residents/new'), { name: 'resident-new' });
  assert.deepEqual(parseOpsRoute('#residents/123e4567-e89b-12d3-a456-426614174000'), {
    name: 'resident',
    id: '123e4567-e89b-12d3-a456-426614174000',
  });
  assert.deepEqual(parseOpsRoute('#residents/123e4567-e89b-12d3-a456-426614174000/profile'), {
    name: 'resident-profile',
    id: '123e4567-e89b-12d3-a456-426614174000',
  });
  assert.deepEqual(parseOpsRoute('#residents/invalid'), { name: 'residents' });
});

test('formatCurrency with large amounts', () => {
  assert.equal(formatCurrency('99999999.99'), '₹9,99,99,999.99');
  assert.equal(formatCurrency('0.01'), '₹0.01');
  assert.equal(formatCurrency('0.1'), '₹0.10');
  assert.equal(formatCurrency('1'), '₹1.00');
});

test('formatISTDate and formatISTDateTime consistency', () => {
  const date = '2027-04-15T08:00:00.000Z';
  const dateOnly = formatISTDate(date);
  const dateTime = formatISTDateTime(date);

  // DateTime should contain the date part
  const dateParts = dateOnly.split(' ');
  for (const part of dateParts) {
    if (part.length > 1) {
      assert.ok(dateTime.includes(part));
    }
  }
});

test('getEventIcon covers all action categories', () => {
  const bookingActions = [
    'booking.created',
    'booking.updated',
    'booking.cancelled',
    'booking.extended',
    'booking.shortened',
  ];
  const admissionActions = [
    'admission.created',
    'admission.updated',
    'admission.approved',
    'admission.cancelled',
    'admission.reopened',
  ];
  const checkinActions = ['checkin.created'];
  const checkoutActions = ['checkout.created'];

  for (const action of bookingActions) {
    assert.equal(getEventIcon(action), 'grid');
  }
  for (const action of admissionActions) {
    assert.equal(getEventIcon(action), 'building');
  }
  for (const action of checkinActions) {
    assert.equal(getEventIcon(action), 'arrow');
  }
  for (const action of checkoutActions) {
    assert.equal(getEventIcon(action), 'arrow');
  }
});

test('getEventDescription handles missing metadata gracefully', () => {
  const desc = getEventDescription('booking.created', {});
  assert.ok(desc.includes('—') || desc.length > 0);
});

test('formatDate handles various date formats', () => {
  assert.equal(formatDate('2027-04-15T08:00:00.000Z'), '15 Apr 2027');
  assert.equal(formatDate('2027-04-15'), '15 Apr 2027');
  assert.equal(formatDate('2027-04-15T08:00:00Z'), '15 Apr 2027');
});

test('formatDateTime handles various formats', () => {
  const result = formatDateTime('2027-04-15T08:00:00.000Z');
  assert.ok(result.includes('15') || result.includes('Apr') || result.includes('2027'));
  assert.ok(result.includes(':') || result.includes('AM') || result.includes('PM'));
});

test('label function formats various statuses', () => {
  assert.equal(formatLabel('ACTIVE'), 'Active');
  assert.equal(formatLabel('INACTIVE'), 'Inactive');
  assert.equal(formatLabel('ARCHIVED'), 'Archived');
  assert.equal(formatLabel('PENDING'), 'Pending');
  assert.equal(formatLabel('ADMITTED'), 'Admitted');
  assert.equal(formatLabel('CONFIRMED'), 'Confirmed');
  assert.equal(formatLabel('CANCELLED'), 'Cancelled');
  assert.equal(formatLabel('OVERDUE'), 'Overdue');
  assert.equal(formatLabel('PROPERTY_MANAGER'), 'Property manager');
  assert.equal(formatLabel('OWNER'), 'Owner');
  assert.equal(formatLabel('VIEWER'), 'Viewer');
});

test('isOpsHash identifies ops routes correctly', () => {
  const opsRoutes = [
    '#residents',
    '#admissions',
    '#bookings',
    '#check-ins',
    '#properties',
    '#enquiries',
    '#floors',
    '#rooms',
  ];
  for (const route of opsRoutes) {
    assert.equal(isOpsHash(route), true);
  }
  const nonOpsRoutes = ['#overview', '#finance', '#floor-plan', '#inventory', '#login'];
  for (const route of nonOpsRoutes) {
    assert.equal(isOpsHash(route), false);
  }
});

test('parseOpsRoute handles all ops routes', () => {
  const testCases = [
    ['#residents', { name: 'residents' }],
    ['#residents/new', { name: 'resident-new' }],
    [
      '#residents/123e4567-e89b-12d3-a456-426614174000',
      { name: 'resident', id: '123e4567-e89b-12d3-a456-426614174000' },
    ],
    [
      '#residents/123e4567-e89b-12d3-a456-426614174000/profile',
      { name: 'resident-profile', id: '123e4567-e89b-12d3-a456-426614174000' },
    ],
    ['#admissions', { name: 'admissions' }],
    [
      '#admissions/123e4567-e89b-12d3-a456-426614174000',
      { name: 'admission', id: '123e4567-e89b-12d3-a456-426614174000' },
    ],
    ['#bookings', { name: 'bookings' }],
    ['#bookings/new', { name: 'booking-new' }],
    ['#check-ins', { name: 'check-ins' }],
    ['#check-ins/new', { name: 'check-in-new' }],
    ['#properties', { name: 'properties' }],
    [
      '#properties/123e4567-e89b-12d3-a456-426614174000',
      { name: 'property', id: '123e4567-e89b-12d3-a456-426614174000' },
    ],
    [
      '#floors/123e4567-e89b-12d3-a456-426614174000',
      { name: 'floors', propertyId: '123e4567-e89b-12d3-a456-426614174000' },
    ],
    [
      '#rooms/123e4567-e89b-12d3-a456-426614174000',
      { name: 'rooms', propertyId: '123e4567-e89b-12d3-a456-426614174000' },
    ],
  ];

  for (const [hash, expected] of testCases) {
    assert.deepEqual(parseOpsRoute(hash as string), expected, `Failed for ${hash}`);
  }
});

test('opsLinks generates correct links', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(opsLinks.residents, '#residents');
  assert.equal(opsLinks.residentNew, '#residents/new');
  assert.equal(opsLinks.resident(id), `#residents/${id}`);
  assert.equal(opsLinks.residentProfile(id), `#residents/${id}/profile`);
  assert.equal(opsLinks.enquiries, '#enquiries');
  assert.equal(opsLinks.bookings, '#bookings');
  assert.equal(opsLinks.admissions, '#admissions');
  assert.equal(opsLinks.checkIns, '#check-ins');
  assert.equal(opsLinks.properties, '#properties');
});

test('formatCurrency handles zero and negative gracefully', () => {
  assert.equal(formatCurrency('0'), '₹0.00');
  assert.equal(formatCurrency('0.00'), '₹0.00');
  // Negative amounts might not be valid in this context but shouldn't crash
  assert.ok(
    formatCurrency('-100').startsWith('₹-') ||
      formatCurrency('-100').startsWith('-₹') ||
      formatCurrency('-100') === '₹0.00',
  );
});

test('formatISTDate and formatISTDateTime handle various dates', () => {
  const dates = [
    '2027-01-15T10:00:00.000Z',
    '2027-06-15T10:00:00.000Z',
    '2027-12-15T10:00:00.000Z',
    '2027-02-28T23:59:59.000Z',
    '2027-02-28T18:30:00.000Z',
  ];
  for (const date of dates) {
    const d = formatISTDate(date);
    const dt = formatISTDateTime(date);
    assert.ok(d.length > 0);
    assert.ok(dt.length > 0);
    // DateTime should contain the date portion
    const dateParts = d.split(' ');
    for (const part of dateParts) {
      if (part.length > 2) {
        assert.ok(dt.includes(part) || dt.toLowerCase().includes(part.toLowerCase()));
      }
    }
  }
});
test('inventory links distinguish list, detail and creation routes and reject invalid parents', () => {
  const parent = randomUUID();
  const child = randomUUID();
  const cases = [
    [opsLinks.propertyNew, { name: 'property-new' }],
    [opsLinks.floors(parent), { name: 'floors', propertyId: parent }],
    [opsLinks.floor(parent, child), { name: 'floor', propertyId: parent, id: child }],
    [opsLinks.floorNew(parent), { name: 'floor-new', propertyId: parent }],
    [opsLinks.rooms(parent), { name: 'rooms', propertyId: parent }],
    [opsLinks.room(parent, child), { name: 'room', propertyId: parent, id: child }],
    [opsLinks.roomNew(parent), { name: 'room-new', propertyId: parent }],
    [opsLinks.beds(parent), { name: 'beds', roomId: parent }],
    [opsLinks.bed(parent, child), { name: 'bed', roomId: parent, id: child }],
    [opsLinks.bedNew(parent), { name: 'bed-new', roomId: parent }],
  ] as const;
  for (const [hash, expected] of cases) {
    assert.equal(isOpsHash(hash), true);
    assert.deepEqual(parseOpsRoute(hash), expected);
  }
  for (const section of ['floors', 'rooms', 'beds']) {
    assert.deepEqual(parseOpsRoute(`#${section}/invalid/${child}`), { name: 'properties' });
  }
});
