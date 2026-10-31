import assert from 'node:assert/strict';
import test from 'node:test';
import {
  toPaise,
  formatINR,
  parseRupeesToPaise,
  addPaise,
  subtractPaise,
  sumPaise,
} from './utils/money';

test('toPaise converts bigint, numbers and integer strings safely', () => {
  assert.equal(toPaise(100n), 100n);
  assert.equal(toPaise(100), 100n);
  assert.equal(toPaise('100'), 100n);
  assert.equal(toPaise(0), 0n);
  assert.equal(toPaise(-500), -500n);

  assert.throws(() => toPaise(10.5), /integer/);
  assert.throws(() => toPaise('10.5'), /Non-integers forbidden/);
  assert.throws(() => toPaise(NaN), /integer/);
  assert.throws(() => toPaise(Infinity), /integer/);
});

test('formatINR formats integer paise with standard Indian digit grouping (₹)', () => {
  // ₹0.00
  assert.equal(formatINR(0n), '₹0.00');
  // 50 paise
  assert.equal(formatINR(50n), '₹0.50');
  // 1 Rupee
  assert.equal(formatINR(100n), '₹1.00');
  // ₹1,000.00 (thousands)
  assert.equal(formatINR(100000n), '₹1,000.00');
  // ₹10,000.00 (ten thousands)
  assert.equal(formatINR(1000000n), '₹10,000.00');
  // ₹1,50,000.00 (one lakh fifty thousand)
  assert.equal(formatINR(15000000n), '₹1,50,000.00');
  // ₹12,34,567.89 (twelve lakh thirty-four thousand...)
  assert.equal(formatINR(123456789n), '₹12,34,567.89');
  // ₹1,00,00,000.00 (one crore)
  assert.equal(formatINR(1000000000n), '₹1,00,00,000.00');
  // ₹10,50,75,123.45 (ten crore fifty lakh seventy-five thousand...)
  assert.equal(formatINR(10507512345n), '₹10,50,75,123.45');
});

test('formatINR supports options: showPaise, showSymbol, and negative amounts', () => {
  assert.equal(formatINR(15000000n, { showPaise: false }), '₹1,50,000');
  assert.equal(formatINR(15000000n, { showSymbol: false }), '1,50,000.00');
  assert.equal(formatINR(-50000n), '- ₹500.00');
  assert.equal(formatINR(-50000n, { useSign: true }), '-₹500.00');
});

test('parseRupeesToPaise converts user input strings accurately without floats', () => {
  assert.equal(parseRupeesToPaise('0'), 0n);
  assert.equal(parseRupeesToPaise('1'), 100n);
  assert.equal(parseRupeesToPaise('1.5'), 150n);
  assert.equal(parseRupeesToPaise('1.50'), 150n);
  assert.equal(parseRupeesToPaise('₹ 1,50,000'), 15000000n);
  assert.equal(parseRupeesToPaise('₹1,50,000.50'), 15000050n);
  assert.equal(parseRupeesToPaise('12,34,567.89'), 123456789n);
  assert.equal(parseRupeesToPaise('-500'), -50000n);

  assert.throws(() => parseRupeesToPaise('abc'), /Invalid currency format/);
  assert.throws(() => parseRupeesToPaise('1.234'), /Invalid currency format/);
  assert.throws(() => parseRupeesToPaise(''), /empty/);
});

test('addPaise, subtractPaise, and sumPaise perform exact integer calculations', () => {
  const rent = 1500000n; // ₹15,000.00
  const deposit = 3000000n; // ₹30,000.00
  const deduction = 250000n; // ₹2,500.00

  assert.equal(addPaise(rent, deposit), 4500000n);
  assert.equal(subtractPaise(deposit, deduction), 2750000n);
  assert.equal(sumPaise([rent, deposit, -deduction]), 4250000n);
});
