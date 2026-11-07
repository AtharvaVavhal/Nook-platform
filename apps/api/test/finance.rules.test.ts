import assert from 'node:assert/strict';
import test from 'node:test';
import { istDateOf, resolveInstant } from '../src/common/time.js';
import {
  bookingCoversMonth,
  dueDateAtIssue,
  isMonthBillable,
  monthRangeIst,
  parseBillingMonth,
  stayOverlapsMonth,
} from '../src/finance/finance.util.js';

const m = (month: string) => parseBillingMonth(month);
const d = (iso: string) => new Date(iso);
const day = (iso: string) => d(`${iso}T00:00:00Z`);
const covers = (start: string, end: string, month: string) =>
  bookingCoversMonth({ startDate: d(start), endDate: d(end) }, m(month));
const iso = (value: Date) => value.toISOString().slice(0, 10);

// ----------------------------------------------- 1. exclusive booking end, IST dates

test('booking end is exclusive: a booking ending on the 1st does not bill that month', () => {
  assert.equal(covers('2026-10-01', '2026-11-01', '2026-11'), false);
  assert.equal(covers('2026-10-01', '2026-11-01', '2026-10'), true);
  assert.equal(covers('2026-10-01', '2026-11-02', '2026-11'), true);
});

test('booking end: the last day of a month still bills that month', () => {
  assert.equal(covers('2026-11-10', '2026-11-30', '2026-11'), true);
  assert.equal(covers('2026-11-10', '2026-12-01', '2026-12'), false);
});

test('booking start: the 1st and the last day of the month both bill that month', () => {
  assert.equal(covers('2026-11-01', '2027-11-01', '2026-11'), true);
  assert.equal(covers('2026-11-30', '2027-11-30', '2026-11'), true);
  assert.equal(covers('2026-11-30', '2027-11-30', '2026-10'), false);
  assert.equal(covers('2026-12-01', '2027-12-01', '2026-11'), false);
});

test('booking boundaries across a year change', () => {
  assert.equal(covers('2026-12-01', '2027-01-01', '2026-12'), true);
  assert.equal(covers('2026-12-01', '2027-01-01', '2027-01'), false);
  assert.equal(covers('2026-12-31', '2027-01-31', '2026-12'), true);
  assert.equal(covers('2026-12-31', '2027-01-31', '2027-01'), true);
  assert.equal(covers('2027-01-01', '2027-02-01', '2026-12'), false);
});

test('booking boundaries are Asia/Kolkata calendar dates, not UTC dates', () => {
  // 18:30Z is midnight IST of the next day.
  // Start 2026-11-30T18:30Z is 1 Dec IST, so November is not billed (a UTC reading would bill it).
  assert.equal(covers('2026-11-30T18:30:00Z', '2027-06-01T00:00:00Z', '2026-11'), false);
  assert.equal(covers('2026-11-30T18:30:00Z', '2027-06-01T00:00:00Z', '2026-12'), true);
  // One minute earlier is still 30 Nov IST.
  assert.equal(covers('2026-11-30T18:29:00Z', '2027-06-01T00:00:00Z', '2026-11'), true);
  // End 2026-10-31T18:30Z is 1 Nov IST: exclusive, so November is not billed.
  assert.equal(covers('2026-09-01T00:00:00Z', '2026-10-31T18:30:00Z', '2026-11'), false);
  assert.equal(covers('2026-09-01T00:00:00Z', '2026-10-31T18:30:00Z', '2026-10'), true);
  // End 2026-10-31T18:29Z is still 31 Oct IST.
  assert.equal(covers('2026-09-01T00:00:00Z', '2026-10-31T18:29:00Z', '2026-10'), true);
  // A date supplied with an IST offset: 2026-11-01T00:00+05:30 is 1 Nov IST.
  assert.equal(covers('2026-09-01T00:00:00Z', '2026-11-01T00:00:00+05:30', '2026-11'), false);
});

test('back-to-back bookings never bill the same month twice for one bed', () => {
  const a = { startDate: day('2026-10-01'), endDate: day('2026-11-01') };
  const b = { startDate: day('2026-11-01'), endDate: day('2026-12-01') };
  for (const [month, wantA, wantB] of [
    ['2026-10', true, false],
    ['2026-11', false, true],
    ['2026-12', false, false],
  ] as const) {
    assert.equal(bookingCoversMonth(a, m(month)), wantA, `A ${month}`);
    assert.equal(bookingCoversMonth(b, m(month)), wantB, `B ${month}`);
  }
});

test('a one-day booking bills only its own month', () => {
  assert.equal(covers('2026-11-05', '2026-11-06', '2026-11'), true);
  assert.equal(covers('2026-11-05', '2026-11-06', '2026-10'), false);
  assert.equal(covers('2026-11-05', '2026-11-06', '2026-12'), false);
});

// ---------------------------------------------------------- 2. stay-based eligibility

const stay = (over: Partial<Parameters<typeof stayOverlapsMonth>[0]> = {}) => ({
  checkInAt: d('2026-11-03T04:00:00Z'),
  status: 'ACTIVE',
  checkOutAt: null as Date | null,
  updatedAt: d('2026-11-03T04:00:00Z'),
  ...over,
});
const booking = { startDate: day('2026-11-01'), endDate: day('2027-11-01') };

test('stay: normal check-out bills the months it occupied, and not later ones', () => {
  const s = stay({ status: 'CHECKED_OUT', checkOutAt: d('2026-12-10T05:00:00Z') });
  assert.equal(isMonthBillable(s, booking, m('2026-11')), true);
  assert.equal(isMonthBillable(s, booking, m('2026-12')), true);
  assert.equal(isMonthBillable(s, booking, m('2027-01')), false);
});

test('stay: early check-out stops billing even though the booking continues', () => {
  const s = stay({ status: 'CHECKED_OUT', checkOutAt: d('2026-11-12T05:00:00Z') });
  assert.equal(isMonthBillable(s, booking, m('2026-11')), true);
  assert.equal(isMonthBillable(s, booking, m('2026-12')), false);
});

test('stay: check-out completed before the month began excludes it (IST midnight boundary)', () => {
  // 2026-10-31T18:29Z is 23:59 IST on 31 Oct; 18:30Z is 00:00 IST on 1 Nov.
  const before = stay({ status: 'CHECKED_OUT', checkOutAt: d('2026-10-31T18:29:00Z') });
  const onFirst = stay({ status: 'CHECKED_OUT', checkOutAt: d('2026-10-31T18:30:00Z') });
  assert.equal(
    stayOverlapsMonth({ ...before, checkInAt: d('2026-09-20T00:00:00Z') }, m('2026-11')),
    false,
  );
  assert.equal(
    stayOverlapsMonth({ ...onFirst, checkInAt: d('2026-09-20T00:00:00Z') }, m('2026-11')),
    true,
  );
});

test('stay: a check-in at or after the month end (IST) does not bill that month', () => {
  assert.equal(
    stayOverlapsMonth(stay({ checkInAt: d('2026-11-30T18:29:00Z') }), m('2026-11')),
    true,
  );
  assert.equal(
    stayOverlapsMonth(stay({ checkInAt: d('2026-11-30T18:30:00Z') }), m('2026-11')),
    false,
  );
});

test('stay: CHECKED_OUT without a check-out row uses the status change time', () => {
  const s = stay({ status: 'CHECKED_OUT', checkOutAt: null, updatedAt: d('2026-11-20T00:00:00Z') });
  assert.equal(stayOverlapsMonth(s, m('2026-11')), true);
  assert.equal(stayOverlapsMonth(s, m('2026-12')), false);
});

test('stay: cancelling the booking or admission later cannot change eligibility (status is not an input)', () => {
  // isMonthBillable has no booking/admission status parameter, so occupied months are billed
  // identically before and after a later cancellation.
  const s = stay({ status: 'CHECKED_OUT', checkOutAt: d('2026-11-20T05:00:00Z') });
  assert.equal(isMonthBillable(s, booking, m('2026-11')), true);
  assert.equal(isMonthBillable(s, { ...booking }, m('2026-11')), true);
  assert.equal(isMonthBillable.length, 3);
});

test('stay: overstaying past the booking end is never billed without an extension', () => {
  const ended = { startDate: day('2026-10-01'), endDate: day('2026-11-01') };
  assert.equal(
    isMonthBillable(stay({ checkInAt: d('2026-10-03T04:00:00Z') }), ended, m('2026-10')),
    true,
  );
  assert.equal(
    isMonthBillable(stay({ checkInAt: d('2026-10-03T04:00:00Z') }), ended, m('2026-11')),
    false,
  );
  assert.equal(
    isMonthBillable(stay({ checkInAt: d('2026-10-03T04:00:00Z') }), ended, m('2026-12')),
    false,
  );
  // An approved extension moves the booking end later; billing follows.
  const extended = { ...ended, endDate: day('2026-12-01') };
  assert.equal(
    isMonthBillable(stay({ checkInAt: d('2026-10-03T04:00:00Z') }), extended, m('2026-11')),
    true,
  );
  assert.equal(
    isMonthBillable(stay({ checkInAt: d('2026-10-03T04:00:00Z') }), extended, m('2026-12')),
    false,
  );
});

test('stay: a future-dated booking bills nothing before it starts, even for an active stay', () => {
  const future = { startDate: day('2027-01-01'), endDate: day('2027-06-01') };
  assert.equal(isMonthBillable(stay(), future, m('2026-12')), false);
  assert.equal(isMonthBillable(stay(), future, m('2027-01')), true);
});

test('stay: two stays in one month are each eligible and the caller bills the month once', () => {
  const first = stay({
    status: 'CHECKED_OUT',
    checkInAt: d('2026-11-02T04:00:00Z'),
    checkOutAt: d('2026-11-10T04:00:00Z'),
  });
  const second = stay({ checkInAt: d('2026-11-15T04:00:00Z') });
  assert.equal(isMonthBillable(first, booking, m('2026-11')), true);
  assert.equal(isMonthBillable(second, booking, m('2026-11')), true);
});

// -------------------------------------------------------------------- 4. due dates

test('due date is the later of the 5th and the issue date (Asia/Kolkata)', () => {
  const due = (periodMonth: string, issuedAt: string) =>
    iso(dueDateAtIssue(m(periodMonth).periodStart, d(issuedAt)));
  assert.equal(due('2026-11', '2026-11-03T06:00:00Z'), '2026-11-05'); // before the 5th
  assert.equal(due('2026-11', '2026-11-05T06:00:00Z'), '2026-11-05'); // on the 5th
  assert.equal(due('2026-11', '2026-11-06T06:00:00Z'), '2026-11-06'); // after the 5th
  assert.equal(due('2026-11', '2026-11-30T06:00:00Z'), '2026-11-30'); // last day of the month
  assert.equal(due('2026-11', '2026-10-20T06:00:00Z'), '2026-11-05'); // issued ahead of the month
  assert.equal(due('2026-11', '2026-12-09T06:00:00Z'), '2026-12-09'); // issued after the month
  assert.equal(due('2026-12', '2027-01-03T06:00:00Z'), '2027-01-03'); // year boundary
  assert.equal(due('2026-12', '2026-12-31T19:00:00Z'), '2027-01-01'); // 00:30 IST on 1 Jan
  assert.equal(due('2027-01', '2026-12-31T19:00:00Z'), '2027-01-05');
});

test('due date uses the IST calendar date of issue across the 18:30Z rollover', () => {
  const due = (issuedAt: string) => iso(dueDateAtIssue(m('2026-11').periodStart, d(issuedAt)));
  assert.equal(due('2026-11-05T18:29:00Z'), '2026-11-05');
  assert.equal(due('2026-11-05T18:30:00Z'), '2026-11-06');
});

// ------------------------------------------------------------- 5. Asia/Kolkata time

test('report month ranges are Asia/Kolkata midnights', () => {
  const { from, to } = monthRangeIst(m('2026-11'));
  assert.equal(from.toISOString(), '2026-10-31T18:30:00.000Z');
  assert.equal(to.toISOString(), '2026-11-30T18:30:00.000Z');
  const inRange = (instant: string) => d(instant) >= from && d(instant) < to;
  assert.equal(inRange('2026-10-31T19:00:00Z'), true); // 00:30 IST on 1 Nov belongs to November
  assert.equal(inRange('2026-10-31T18:00:00Z'), false); // 23:30 IST on 31 Oct belongs to October
  assert.equal(inRange('2026-11-30T18:00:00Z'), true); // 23:30 IST on 30 Nov is still November
  assert.equal(inRange('2026-11-30T18:30:00Z'), false);
});

test('zone-less receivedAt is read as Asia/Kolkata, and explicit offsets are respected', () => {
  assert.equal(
    resolveInstant('2026-11-02T10:00', 'receivedAt').toISOString(),
    '2026-11-02T04:30:00.000Z',
  );
  assert.equal(
    resolveInstant('2026-11-02', 'receivedAt').toISOString(),
    '2026-11-01T18:30:00.000Z',
  );
  assert.equal(
    resolveInstant('2026-11-02T10:00:00Z', 'receivedAt').toISOString(),
    '2026-11-02T10:00:00.000Z',
  );
  assert.equal(
    resolveInstant('2026-11-02T10:00:00+05:30', 'receivedAt').toISOString(),
    '2026-11-02T04:30:00.000Z',
  );
});

test('results are identical under different process time zones', () => {
  const original = process.env.TZ;
  const snapshot = () => ({
    recv: [
      resolveInstant('2026-11-02T10:00', 'x').toISOString(),
      resolveInstant('2026-11-02', 'x').toISOString(),
      resolveInstant('2026-11-02 23:59:59', 'x').toISOString(),
    ],
    istDates: ['2026-10-31T18:30:00Z', '2026-10-31T18:29:59Z', '2026-12-31T19:00:00Z'].map((v) =>
      iso(istDateOf(d(v))),
    ),
    range: (({ from, to }) => [from.toISOString(), to.toISOString()])(monthRangeIst(m('2026-11'))),
    covers: [
      covers('2026-11-30T18:30:00Z', '2027-06-01T00:00:00Z', '2026-11'),
      covers('2026-09-01T00:00:00Z', '2026-10-31T18:30:00Z', '2026-11'),
      covers('2026-10-01', '2026-11-01', '2026-11'),
    ],
    due: [
      iso(dueDateAtIssue(m('2026-11').periodStart, d('2026-11-05T18:30:00Z'))),
      iso(dueDateAtIssue(m('2026-12').periodStart, d('2026-12-31T19:00:00Z'))),
    ],
    stay: stayOverlapsMonth(
      {
        checkInAt: d('2026-09-20T00:00:00Z'),
        status: 'CHECKED_OUT',
        checkOutAt: d('2026-10-31T18:29:00Z'),
        updatedAt: d('2026-11-01T00:00:00Z'),
      },
      m('2026-11'),
    ),
  });
  try {
    const results = ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'].map(
      (zone) => {
        process.env.TZ = zone;
        return { zone, result: snapshot() };
      },
    );
    for (const { zone, result } of results) {
      assert.deepEqual(result, results[0]!.result, `differs under TZ=${zone}`);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
