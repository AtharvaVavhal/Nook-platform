import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidAmountInput, monthLabel, toMinorUnits } from './finance/financeFormat.js';
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
