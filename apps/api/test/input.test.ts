import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { parseDateInput, requiredPhone, queryInt, optionalInt } from '../src/common/input.js';
import {
  assertValidPeriod,
  parseAvailabilityQuery,
  parseBookingQuery,
  parseCreateBooking,
  parseMonthlyPrice,
  parseUpdateBooking,
} from '../src/booking/booking.input.js';
import { parseCreateAdmission, parseUpdateAdmission } from '../src/admission/admission.input.js';
import {
  parseCreateEnquiry,
  parseEnquiryQuery,
  parseFollowUp,
  parseUpcomingDays,
  parseUpdateEnquiry,
} from '../src/enquiry/enquiry.input.js';

const ID = '3f2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e6f';
const ID2 = '9a2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e70';

const bad = (fn: () => unknown, pattern?: RegExp) =>
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof BadRequestException, `expected a 400, got ${String(e)}`);
    if (pattern) assert.match(String((e as Error).message), pattern);
    return true;
  });

const booking = (over: Record<string, unknown> = {}) => ({
  residentId: ID,
  bedId: ID2,
  startDate: '2026-12-01',
  endDate: '2027-03-01',
  monthlyPrice: 5000,
  ...over,
});

test('dates: date-only values are real calendar days stored as UTC midnight; garbage and impossible days are 400', () => {
  assert.equal(parseDateInput('2026-12-01', 'd').toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(parseDateInput('2028-02-29', 'd').toISOString(), '2028-02-29T00:00:00.000Z');
  for (const value of [
    'abc',
    '',
    '2027-02-30',
    '2027-13-01',
    '2027-1-1',
    20270101,
    null,
    undefined,
    {},
    ['2027-01-01'],
  ]) {
    bad(() => parseDateInput(value, 'd'), /valid date/);
  }
  bad(() => parseDateInput('1999-12-31', 'd'), /between the years/);
  bad(() => parseDateInput('2101-01-01', 'd'), /between the years/);
});

test('dates: a time with a zone keeps it, a time without one is Asia/Kolkata whatever the server zone is', () => {
  assert.equal(
    parseDateInput('2026-12-01T10:00:00Z', 'd').toISOString(),
    '2026-12-01T10:00:00.000Z',
  );
  assert.equal(parseDateInput('2026-12-01T10:00', 'd').toISOString(), '2026-12-01T04:30:00.000Z');
});

test('booking create: a valid request is parsed, the price becomes a two-decimal string', () => {
  const parsed = parseCreateBooking(booking({ notes: '  corner bed  ' }));
  assert.equal(parsed.monthlyPrice, '5000.00');
  assert.equal(parsed.notes, 'corner bed');
  assert.equal(parseCreateBooking(booking({ monthlyPrice: '4500.5' })).monthlyPrice, '4500.50');
  assert.equal(parseCreateBooking(booking({ notes: undefined })).notes, null);
});

test('booking create: every invalid shape is a 400, never an unhandled error', () => {
  bad(() => parseCreateBooking(null), /JSON object/);
  bad(() => parseCreateBooking([]), /JSON object/);
  bad(() => parseCreateBooking('x'), /JSON object/);
  bad(() => parseCreateBooking(booking({ residentId: 'nope' })), /residentId/);
  bad(() => parseCreateBooking(booking({ bedId: undefined })), /bedId/);
  bad(() => parseCreateBooking(booking({ startDate: 'abc' })), /startDate/);
  bad(() => parseCreateBooking(booking({ endDate: undefined })), /endDate/);
  bad(
    () => parseCreateBooking(booking({ startDate: '2027-03-01', endDate: '2026-12-01' })),
    /after startDate/,
  );
  bad(
    () => parseCreateBooking(booking({ startDate: '2027-03-01', endDate: '2027-03-01' })),
    /after startDate/,
  );
  for (const price of [
    -1,
    0,
    '0',
    '-5000',
    'abc',
    '',
    null,
    undefined,
    {},
    [],
    1.234,
    '12.345',
    1e15,
    '100000000',
    '1e3',
  ]) {
    bad(() => parseCreateBooking(booking({ monthlyPrice: price })), /monthlyPrice/);
  }
  bad(() => parseCreateBooking(booking({ notes: 12 })), /notes/);
  bad(() => parseCreateBooking(booking({ notes: 'x'.repeat(2001) })), /notes/);
});

test('booking create: unknown fields are dropped, so status and organization cannot be injected', () => {
  const parsed = parseCreateBooking(
    booking({ status: 'CANCELLED', paymentStatus: 'PAID', organizationId: ID, id: ID }),
  ) as unknown as Record<string, unknown>;
  for (const key of ['status', 'paymentStatus', 'organizationId', 'id'])
    assert.equal(key in parsed, false);
});

test('booking price: the largest value the column holds is accepted, one cent more is not', () => {
  assert.equal(parseMonthlyPrice('99999999.99'), '99999999.99');
  bad(() => parseMonthlyPrice('100000000.00'));
  bad(() => parseMonthlyPrice(99_999_999.995));
});

test('booking period: a booking covers at least one night, compared as IST calendar days', () => {
  assertValidPeriod(new Date('2026-12-01T00:00:00Z'), new Date('2026-12-02T00:00:00Z'));
  bad(() => assertValidPeriod(new Date('2026-12-01T00:00:00Z'), new Date('2026-12-01T10:00:00Z')));
  // 31 Nov 20:00 UTC is already 1 Dec in India: same IST day as 1 Dec 00:00 UTC
  bad(() => assertValidPeriod(new Date('2026-12-01T00:00:00Z'), new Date('2026-12-01T18:00:00Z')));
});

test('booking update: only known, valid fields; status is CONFIRMED or CANCELLED; clearing dates is refused', () => {
  assert.deepEqual(parseUpdateBooking({}), {});
  const parsed = parseUpdateBooking({
    status: 'CANCELLED',
    paymentStatus: 'PAID',
    monthlyPrice: '6000',
    notes: null,
  });
  assert.deepEqual(parsed, {
    status: 'CANCELLED',
    paymentStatus: 'PAID',
    monthlyPrice: '6000.00',
    notes: null,
  });
  bad(() => parseUpdateBooking({ status: 'DELETED' }), /status/);
  bad(() => parseUpdateBooking({ paymentStatus: 'SOON' }), /paymentStatus/);
  bad(() => parseUpdateBooking({ monthlyPrice: -1 }), /monthlyPrice/);
  bad(() => parseUpdateBooking({ endDate: null }), /cannot be cleared/);
  bad(() => parseUpdateBooking({ startDate: 'x' }), /startDate/);
  bad(() => parseUpdateBooking(null));
});

test('booking queries: filters are validated, arrays and objects are refused', () => {
  const ok = parseBookingQuery({
    status: 'CONFIRMED',
    residentId: ID,
    fromDate: '2026-01-01',
    toDate: '2026-02-01',
    page: '2',
  });
  assert.equal(ok.status, 'CONFIRMED');
  assert.equal(ok.page, '2');
  bad(() => parseBookingQuery({ status: 'NOPE' }), /status/);
  bad(() => parseBookingQuery({ residentId: 'x' }), /residentId/);
  bad(() => parseBookingQuery({ fromDate: 'x' }), /fromDate/);
  bad(() => parseBookingQuery({ fromDate: '2026-02-01', toDate: '2026-01-01' }), /toDate/);
  bad(() => parseBookingQuery({ status: ['CONFIRMED', 'CANCELLED'] }), /single value/);
  bad(() => parseBookingQuery({ search: 'x'.repeat(101) }), /search/);
  assert.deepEqual(parseBookingQuery({}).search, undefined);
});

test('availability query: both dates required, end after start, property must be a UUID', () => {
  assert.equal(
    parseAvailabilityQuery({ startDate: '2026-12-01', endDate: '2026-12-31' }).propertyId,
    undefined,
  );
  bad(() => parseAvailabilityQuery({}), /required/);
  bad(() => parseAvailabilityQuery({ startDate: '2026-12-01' }), /required/);
  bad(() => parseAvailabilityQuery({ startDate: 'x', endDate: '2026-12-31' }), /startDate/);
  bad(
    () => parseAvailabilityQuery({ startDate: '2026-12-31', endDate: '2026-12-01' }),
    /after startDate/,
  );
  bad(
    () =>
      parseAvailabilityQuery({ startDate: '2026-12-01', endDate: '2026-12-31', propertyId: 'p' }),
    /propertyId/,
  );
});

test('admission create and update: ids, date, notes and status are validated', () => {
  const ok = parseCreateAdmission({ bookingId: ID, admissionDate: '2026-12-01', notes: 'n' });
  assert.equal(ok.admissionDate.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(ok.propertyId, null);
  bad(() => parseCreateAdmission({ admissionDate: '2026-12-01' }), /bookingId/);
  bad(() => parseCreateAdmission({ bookingId: ID }), /admissionDate/);
  bad(() => parseCreateAdmission({ bookingId: ID, admissionDate: 'tomorrow' }), /admissionDate/);
  bad(
    () => parseCreateAdmission({ bookingId: ID, admissionDate: '2026-12-01', notes: 5 }),
    /notes/,
  );
  bad(
    () => parseCreateAdmission({ bookingId: ID, admissionDate: '2026-12-01', roomId: 'r' }),
    /roomId/,
  );
  bad(() => parseCreateAdmission('x'));

  assert.deepEqual(parseUpdateAdmission({ status: 'ADMITTED' }).status, 'ADMITTED');
  assert.equal(parseUpdateAdmission({ roomId: null }).roomId, null);
  assert.equal('roomId' in parseUpdateAdmission({}), false);
  bad(() => parseUpdateAdmission({ status: 'DONE' }), /status/);
  bad(() => parseUpdateAdmission({ admissionDate: null }), /admissionDate/);
  bad(() => parseUpdateAdmission({ bedId: 'b' }), /bedId/);
});

test('enquiry create: names, phone, e-mail, numbers and enums are validated; source defaults to OTHER', () => {
  const ok = parseCreateEnquiry({
    firstName: ' Asha ',
    lastName: 'Rao',
    phone: '+91 98765 43210',
    email: 'a@b.in',
  });
  assert.equal(ok.firstName, 'Asha');
  assert.equal(ok.source, 'OTHER');
  assert.equal(ok.email, 'a@b.in');
  assert.equal(ok.expectedDurationOfStay, null);
  bad(() => parseCreateEnquiry({ lastName: 'Rao', phone: '9000000001' }), /firstName/);
  bad(
    () => parseCreateEnquiry({ firstName: 5, lastName: 'Rao', phone: '9000000001' }),
    /firstName/,
  );
  bad(
    () => parseCreateEnquiry({ firstName: 'A', lastName: 'x'.repeat(101), phone: '9000000001' }),
    /lastName/,
  );
  for (const phone of ['', '12', 'abcdefgh', '<script>', '9'.repeat(21), 98765, undefined]) {
    bad(() => parseCreateEnquiry({ firstName: 'A', lastName: 'B', phone }), /phone/);
  }
  const base = { firstName: 'A', lastName: 'B', phone: '9000000001' };
  bad(() => parseCreateEnquiry({ ...base, email: 'not-an-email' }), /email/);
  bad(() => parseCreateEnquiry({ ...base, source: 'FLYER' }), /source/);
  bad(() => parseCreateEnquiry({ ...base, expectedDurationOfStay: 0 }), /expectedDurationOfStay/);
  bad(() => parseCreateEnquiry({ ...base, expectedDurationOfStay: 1.5 }), /expectedDurationOfStay/);
  bad(() => parseCreateEnquiry({ ...base, numberOfOccupants: 21 }), /numberOfOccupants/);
  bad(() => parseCreateEnquiry({ ...base, expectedMoveInDate: 'soon' }), /expectedMoveInDate/);
  bad(() => parseCreateEnquiry({ ...base, preferredPropertyId: 'p' }), /preferredPropertyId/);
  bad(() => parseCreateEnquiry({ ...base, notes: 'x'.repeat(2001) }), /notes/);
  bad(() => parseCreateEnquiry(null));
});

test('enquiry update: CONVERTED and ARCHIVED cannot be set with PUT, absent fields stay absent', () => {
  assert.deepEqual(parseUpdateEnquiry({ status: 'CONTACTED', notes: 'Called' }), {
    status: 'CONTACTED',
    notes: 'Called',
  });
  assert.deepEqual(parseUpdateEnquiry({}), {});
  assert.equal(parseUpdateEnquiry({ email: null }).email, null);
  bad(() => parseUpdateEnquiry({ status: 'CONVERTED' }), /convert/);
  bad(() => parseUpdateEnquiry({ status: 'ARCHIVED' }), /DELETE/);
  bad(() => parseUpdateEnquiry({ status: 'MAYBE' }), /status/);
  bad(() => parseUpdateEnquiry({ firstName: '' }), /firstName/);
  bad(() => parseUpdateEnquiry({ phone: 'x' }), /phone/);
});

test('enquiry follow-up and queries', () => {
  const f = parseFollowUp({ notes: 'Called', followUpAt: '2026-12-10T10:00:00Z' });
  assert.equal(f.outcome, null);
  bad(() => parseFollowUp({ followUpAt: '2026-12-10T10:00:00Z' }), /notes/);
  bad(() => parseFollowUp({ notes: 'x' }), /followUpAt/);
  bad(() => parseFollowUp({ notes: 'x', followUpAt: 'later' }), /followUpAt/);
  bad(
    () => parseFollowUp({ notes: 'x', followUpAt: '2026-12-10', outcome: 'y'.repeat(501) }),
    /outcome/,
  );
  assert.equal(parseEnquiryQuery({ status: 'LOST', source: 'WALK_IN' }).status, 'LOST');
  bad(() => parseEnquiryQuery({ status: 'X' }), /status/);
  bad(() => parseEnquiryQuery({ source: 'X' }), /source/);
  bad(() => parseEnquiryQuery({ propertyId: 'x' }), /propertyId/);
  assert.equal(parseUpcomingDays(undefined), 7);
  assert.equal(parseUpcomingDays('30'), 30);
  for (const days of ['0', '366', 'abc', '1.5', '-3', ['1', '2']])
    bad(() => parseUpcomingDays(days), /days/);
});

test('small helpers: phone and integer parsing', () => {
  assert.equal(requiredPhone({ p: '(020) 2567-1234' }, 'p'), '(020) 2567-1234');
  assert.equal(optionalInt({ n: '12' }, 'n', 1, 20), 12);
  assert.equal(optionalInt({ n: null }, 'n', 1, 20), null);
  assert.equal(optionalInt({}, 'n', 1, 20), undefined);
  assert.equal(queryInt({}, 'n', 1, 5, 3), 3);
  bad(() => queryInt({ n: '9' }, 'n', 1, 5, 3), /n must be/);
});
