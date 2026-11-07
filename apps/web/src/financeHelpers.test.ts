import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canVoidInvoice,
  currentMonth,
  isValidAmountInput,
  istDate,
  monthLabel,
  receivedAtFor,
  toMinorUnits,
  voidBlockedReason,
} from './finance/financeFormat.js';
import { financeLinks, isFinanceHash, parseFinanceRoute } from './finance/financeRoute.js';

const ID = '3f2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e6f';
const PAY = '9a2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e70';

test('finance routes parse from the hash', () => {
  assert.deepEqual(parseFinanceRoute('#finance'), { name: 'dashboard' });
  assert.deepEqual(parseFinanceRoute('#finance/invoices'), { name: 'invoices' });
  assert.deepEqual(parseFinanceRoute('#finance/invoices/new'), { name: 'new-invoice' });
  assert.deepEqual(parseFinanceRoute(`#finance/invoices/${ID}`), { name: 'invoice', id: ID });
  assert.deepEqual(parseFinanceRoute('#finance/outstanding'), { name: 'outstanding' });
  assert.deepEqual(parseFinanceRoute('#finance/reports'), { name: 'reports' });
  assert.deepEqual(parseFinanceRoute(`#finance/receipt/${ID}`), { name: 'receipt', invoiceId: ID });
  assert.deepEqual(parseFinanceRoute(`#finance/receipt/${ID}/${PAY}`), {
    name: 'receipt',
    invoiceId: ID,
    paymentId: PAY,
  });
});

test('finance routes reject malformed ids and unknown paths safely', () => {
  assert.deepEqual(parseFinanceRoute('#finance/invoices/not-a-uuid'), { name: 'invoices' });
  assert.deepEqual(parseFinanceRoute('#finance/receipt/nope'), { name: 'dashboard' });
  assert.deepEqual(parseFinanceRoute('#finance/anything-else'), { name: 'dashboard' });
  assert.equal(isFinanceHash('#finance'), true);
  assert.equal(isFinanceHash('#finance/reports'), true);
  assert.equal(isFinanceHash('#financeX'), false);
  assert.equal(isFinanceHash('#inventory'), false);
});

test('finance links round-trip through the parser', () => {
  assert.deepEqual(parseFinanceRoute(financeLinks.invoice(ID)), { name: 'invoice', id: ID });
  assert.deepEqual(parseFinanceRoute(financeLinks.receipt(ID, PAY)), {
    name: 'receipt',
    invoiceId: ID,
    paymentId: PAY,
  });
});

test('amount input validation mirrors the server rule', () => {
  for (const ok of ['1', '100', '100.5', '100.50', '0.01'])
    assert.equal(isValidAmountInput(ok), true, ok);
  for (const bad of ['', '0', '0.00', '-1', '1.234', 'abc', '1e3', '1,000', '.5'])
    assert.equal(isValidAmountInput(bad), false, bad);
});

test('minor-unit conversion is exact', () => {
  assert.equal(toMinorUnits('1000.30'), 100030n);
  assert.equal(toMinorUnits('0.1'), 10n);
  assert.equal(toMinorUnits('7'), 700n);
  assert.ok(toMinorUnits('1000.31') > toMinorUnits('1000.30'));
});

test('month labels', () => {
  assert.equal(monthLabel('2026-11'), 'November 2026');
});

test('the billing month and received date are Asia/Kolkata, not the browser zone', () => {
  assert.equal(istDate(new Date('2026-10-31T18:29:00Z')), '2026-10-31');
  assert.equal(istDate(new Date('2026-10-31T18:30:00Z')), '2026-11-01');
  assert.equal(currentMonth(new Date('2026-10-31T18:30:00Z')), '2026-11');
  assert.equal(currentMonth(new Date('2026-12-31T19:00:00Z')), '2027-01');
});

test('receivedAt is now for today and noon India time with an explicit offset for earlier dates', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  assert.equal(receivedAtFor('2026-11-05', now), now.toISOString());
  assert.equal(receivedAtFor('2026-11-01', now), '2026-11-01T06:30:00.000Z');
  // 00:30 IST on the 6th is still the 5th in UTC; it is the 6th for the user.
  const lateNow = new Date('2026-11-05T19:00:00Z');
  assert.equal(receivedAtFor('2026-11-06', lateNow), lateNow.toISOString());
});

test('the Void action is offered only when no cash is held and no credit is applied', () => {
  const inv = (over: object) => ({
    storedStatus: 'ISSUED',
    cashReceived: '0.00',
    adjustmentTotal: '0.00',
    ...over,
  });
  assert.equal(canVoidInvoice(inv({})), true);
  assert.equal(canVoidInvoice(inv({ storedStatus: 'DRAFT' })), true);
  assert.equal(canVoidInvoice(inv({ cashReceived: '100.00' })), false);
  assert.equal(canVoidInvoice(inv({ adjustmentTotal: '-10.00' })), false);
  assert.equal(canVoidInvoice(inv({ storedStatus: 'CANCELLED' })), false);
  assert.equal(voidBlockedReason(inv({})), null);
  assert.equal(voidBlockedReason(inv({ storedStatus: 'CANCELLED' })), null);
  assert.match(voidBlockedReason(inv({ cashReceived: '5.00' })) ?? '', /payments are still held/);
  assert.match(voidBlockedReason(inv({ adjustmentTotal: '-5.00' })) ?? '', /credits/);
  assert.match(
    voidBlockedReason(inv({ cashReceived: '5.00', adjustmentTotal: '-5.00' })) ?? '',
    /credits.*payments/,
  );
});

// ---- overstay banner presentation (the overstay rule itself lives only in the API)
import { OVERSTAY_PREVIEW, summariseOverstays } from './finance/overstaySummary.js';

const overstay = (n: number) => ({
  checkInId: `ci-${n}`,
  bookingId: `b-${n}`,
  bedId: `bed-${n}`,
  residentName: `Resident ${n}`,
  bookingEndDate: '2026-11-01T00:00:00.000Z',
});

test('overstay banner: nothing to show when there are no overstays or no data', () => {
  assert.equal(summariseOverstays(null), null);
  assert.equal(summariseOverstays(undefined), null);
  assert.equal(summariseOverstays({ overstayCount: 0, overstays: [] }), null);
});

test('overstay banner: the exact server count is shown, a few names are previewed, the rest are counted', () => {
  const list = [1, 2, 3, 4, 5].map(overstay);
  const s = summariseOverstays({ overstayCount: 120, overstays: list })!;
  assert.equal(s.count, 120, 'count comes from the server, not from the capped list');
  assert.equal(s.shown.length, OVERSTAY_PREVIEW);
  assert.equal(s.hidden, 117);
  assert.match(s.headline, /^120 residents are still checked in past the booking end date\.$/);

  const one = summariseOverstays({ overstayCount: 1, overstays: [overstay(1)] })!;
  assert.equal(one.headline, '1 resident is still checked in past the booking end date.');
  assert.equal(one.hidden, 0);
});

test('overstay banner: wording carries no money estimate', () => {
  const s = summariseOverstays({ overstayCount: 2, overstays: [overstay(1), overstay(2)] })!;
  assert.doesNotMatch(s.headline, /₹|rs\.?|lost|revenue|\d+\.\d\d/i);
});
