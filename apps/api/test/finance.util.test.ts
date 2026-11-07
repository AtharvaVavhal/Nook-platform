import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Decimal,
  daysOverdue,
  defaultDueDate,
  effectiveStatus,
  formatInvoiceNumber,
  parseBillingMonth,
  parseCredit,
  parseReason,
  statusAfterCorrection,
  parseDateOnly,
  parseMoney,
  receiptNumber,
  shiftMonth,
  statusAfterPayment,
  todayIst,
  billingYearIst,
  istStartOfDay,
} from '../src/finance/finance.util.js';

test('money: decimal arithmetic has no floating point drift', () => {
  const total = new Decimal('0.10').plus('0.20');
  assert.equal(total.toFixed(2), '0.30');
  assert.notEqual(0.1 + 0.2, 0.3, 'sanity: plain JS numbers do drift');
  const remaining = new Decimal('1000.30').minus(new Decimal('0.10')).minus(new Decimal('0.20'));
  assert.equal(remaining.toFixed(2), '1000.00');
});

test('money: parseMoney accepts positive amounts with at most 2 decimals', () => {
  assert.equal(parseMoney('100', 'amount').toFixed(2), '100.00');
  assert.equal(parseMoney(100.5, 'amount').toFixed(2), '100.50');
  assert.equal(parseMoney('0.01', 'amount').toFixed(2), '0.01');
});

test('money: parseMoney rejects zero, negative, excess precision and junk', () => {
  for (const bad of [
    '0',
    '0.00',
    '-5',
    -5,
    '1.234',
    '1e3',
    'abc',
    '',
    null,
    undefined,
    {},
    [],
    true,
    '1,000',
    ' ',
  ]) {
    assert.throws(
      () => parseMoney(bad, 'amount'),
      /amount/,
      `should reject ${JSON.stringify(bad)}`,
    );
  }
});

test('billing month: calendar month boundaries, including leap February', () => {
  const feb = parseBillingMonth('2028-02');
  assert.equal(feb.periodStart.toISOString().slice(0, 10), '2028-02-01');
  assert.equal(feb.periodEnd.toISOString().slice(0, 10), '2028-02-29');
  assert.equal(feb.nextPeriodStart.toISOString().slice(0, 10), '2028-03-01');
  assert.equal(parseBillingMonth('2026-12').periodEnd.toISOString().slice(0, 10), '2026-12-31');
});

test('billing month: rejects malformed input', () => {
  for (const bad of [
    '2026-13',
    '2026-00',
    '26-01',
    '2026-1',
    '2026/01',
    '',
    undefined,
    202601,
    '1999-12',
  ]) {
    assert.throws(() => parseBillingMonth(bad), /month/, `should reject ${String(bad)}`);
  }
});

test('shiftMonth crosses year boundaries', () => {
  assert.equal(shiftMonth(parseBillingMonth('2026-01'), -1).month, '2025-12');
  assert.equal(shiftMonth(parseBillingMonth('2026-11'), 3).month, '2027-02');
});

test('date-only parsing rejects impossible dates', () => {
  assert.equal(parseDateOnly('2026-02-28', 'd').toISOString().slice(0, 10), '2026-02-28');
  assert.throws(() => parseDateOnly('2026-02-30', 'd'));
  assert.throws(() => parseDateOnly('2026-2-3', 'd'));
  assert.throws(() => parseDateOnly(undefined, 'd'));
});

test('default due date is the 5th of the billing month', () => {
  assert.equal(
    defaultDueDate(parseBillingMonth('2026-11').periodStart).toISOString().slice(0, 10),
    '2026-11-05',
  );
});

test('numbering: invoice and receipt formats', () => {
  assert.equal(formatInvoiceNumber(2026, 1), 'INV-2026-0001');
  assert.equal(formatInvoiceNumber(2026, 42), 'INV-2026-0042');
  assert.equal(formatInvoiceNumber(2026, 12345), 'INV-2026-12345');
  const id = '3f2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e6f';
  assert.equal(receiptNumber(id), `RCPT-${id}`);
  assert.equal(receiptNumber(id), receiptNumber(id), 'deterministic');
  assert.notEqual(receiptNumber(id), receiptNumber('3f2b8c1e-7a44-4c55-9d0e-1a2b3c4d5e70'));
});

test('status after payment: PAID only at exactly zero balance', () => {
  const amount = new Decimal('1000.30');
  assert.equal(statusAfterPayment(amount, new Decimal('0.10')), 'PARTIALLY_PAID');
  assert.equal(statusAfterPayment(amount, new Decimal('1000.29')), 'PARTIALLY_PAID');
  assert.equal(
    statusAfterPayment(amount, new Decimal('0.10').plus('0.20').plus('1000.00')),
    'PAID',
  );
});

test('overdue is derived from the due date, not stored automatically', () => {
  const today = new Date(Date.UTC(2026, 10, 10));
  const past = new Date(Date.UTC(2026, 10, 5));
  const dueToday = new Date(Date.UTC(2026, 10, 10));
  assert.equal(effectiveStatus('ISSUED', past, today), 'OVERDUE');
  assert.equal(effectiveStatus('PARTIALLY_PAID', past, today), 'OVERDUE');
  assert.equal(
    effectiveStatus('ISSUED', dueToday, today),
    'ISSUED',
    'due today is not yet overdue',
  );
  assert.equal(effectiveStatus('PAID', past, today), 'PAID', 'paid invoices are never overdue');
  assert.equal(effectiveStatus('DRAFT', past, today), 'DRAFT');
  assert.equal(effectiveStatus('CANCELLED', past, today), 'CANCELLED');
  assert.equal(daysOverdue(past, today), 5);
  assert.equal(daysOverdue(dueToday, today), 0);
});

test('Asia/Kolkata: the billing day and year roll over at 18:30 UTC', () => {
  assert.equal(todayIst(new Date('2026-12-31T18:29:59Z')).toISOString().slice(0, 10), '2026-12-31');
  assert.equal(todayIst(new Date('2026-12-31T18:30:00Z')).toISOString().slice(0, 10), '2027-01-01');
  assert.equal(billingYearIst(new Date('2026-12-31T18:29:59Z')), 2026);
  assert.equal(billingYearIst(new Date('2026-12-31T18:30:00Z')), 2027);
  assert.equal(billingYearIst(new Date('2027-01-01T00:00:00Z')), 2027);
});

test('Asia/Kolkata: a date-only value begins 5h30 before UTC midnight', () => {
  assert.equal(
    istStartOfDay(new Date(Date.UTC(2026, 10, 1))).toISOString(),
    '2026-10-31T18:30:00.000Z',
  );
});

test('credits: only negative amounts with at most 2 decimals are accepted', () => {
  assert.equal(parseCredit('-150.50', 'amount').toFixed(2), '-150.50');
  assert.equal(parseCredit(-20, 'amount').toFixed(2), '-20.00');
  for (const bad of [
    '50',
    '+50',
    '0',
    '-0',
    '-0.00',
    '-1.234',
    '-abc',
    '',
    ' ',
    null,
    undefined,
    {},
    '-1e2',
    '--5',
  ]) {
    assert.throws(
      () => parseCredit(bad, 'amount'),
      /amount/,
      `should reject ${JSON.stringify(bad)}`,
    );
  }
  assert.throws(() => parseCredit('50', 'amount'), /credits only/);
});

test('reason: required, trimmed, 3 to 500 characters', () => {
  assert.equal(parseReason('  Duplicate entry  '), 'Duplicate entry');
  for (const bad of [undefined, null, '', '  ', 'ab', 'x'.repeat(501), 5, {}]) {
    assert.throws(() => parseReason(bad), /reason/, `should reject ${JSON.stringify(bad)}`);
  }
});

test('status after a correction follows the settled amount and the cash held', () => {
  const amount = new Decimal('1000.00');
  assert.equal(
    statusAfterCorrection(amount, new Decimal('1000.00'), new Decimal('800.00')),
    'PAID',
  );
  assert.equal(
    statusAfterCorrection(amount, new Decimal('500.00'), new Decimal('300.00')),
    'PARTIALLY_PAID',
  );
  assert.equal(statusAfterCorrection(amount, new Decimal('200.00'), new Decimal('0.00')), 'ISSUED');
  assert.equal(statusAfterCorrection(amount, new Decimal('0.00'), new Decimal('0.00')), 'ISSUED');
});
