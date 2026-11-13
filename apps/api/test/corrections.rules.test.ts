/* eslint-disable @typescript-eslint/no-explicit-any -- error-shaped fixtures and thrown HttpException probes */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ageDays,
  canonicalJson,
  diffSnapshot,
  evidenceRequired,
  istDayKeyOf,
  isExceptional,
  parseCalendarDate,
  parseMoney,
  parseProposedValue,
  parseZonedInstant,
  requestCheck,
  reviewerRoleAllowed,
} from '../src/corrections/corrections.rules.js';
import { classifyFailure, isAutoRetryable, sqlStates } from '../src/common/tx-errors.js';
import {
  ORDINARY_TX_OPTIONS,
  CORRECTION_TX_OPTIONS,
  acquireOrgGate,
  orgGateKeyText,
} from '../src/common/org-gate.js';

const bad = (fn: () => unknown) => assert.throws(fn, (e: any) => e.getStatus() === 400);

test('instants: an explicit zone is mandatory, offsets are applied, microseconds are preserved as text', () => {
  const p = parseZonedInstant('2026-03-05T09:30:15.123456+05:30', 'x');
  assert.equal(p.canonical, '2026-03-05T04:00:15.123456Z');
  assert.equal(
    p.date.toISOString(),
    '2026-03-05T04:00:15.123Z',
    'the Date is millisecond resolution; the text keeps the rest',
  );
  assert.equal(
    parseZonedInstant('2026-03-05T09:30:15Z', 'x').canonical,
    '2026-03-05T09:30:15.000000Z',
  );
  assert.equal(
    parseZonedInstant('2026-03-05T23:30:00-05:00', 'x').canonical,
    '2026-03-06T04:30:00.000000Z',
  );
  for (const raw of [
    '2026-03-05T09:30:15',
    '2026-03-05',
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-03-05T24:00:00Z',
    '2026-03-05T09:30:60Z',
    '2026-03-05T09:30:00+25:00',
    5,
    null,
  ]) {
    bad(() => parseZonedInstant(raw, 'x'));
  }
});

test('calendar dates are real dates, never normalized by JavaScript', () => {
  assert.equal(parseCalendarDate('2024-02-29', 'd'), '2024-02-29');
  for (const raw of [
    '2026-02-29',
    '2026-04-31',
    '2026-1-1',
    '1999-12-31',
    '2026-02-28T00:00:00Z',
    null,
  ])
    bad(() => parseCalendarDate(raw, 'd'));
});

test('money: canonical two decimals, positive, bounded, no floats', () => {
  assert.equal(parseMoney('8500', 'm'), '8500.00');
  assert.equal(parseMoney('8500.5', 'm'), '8500.50');
  assert.equal(parseMoney('99999999.99', 'm'), '99999999.99');
  for (const raw of ['0', '0.00', '-5', '1.234', '100000000', '8,500', 8500, '', ' 5'])
    bad(() => parseMoney(raw, 'm'));
});

test('proposed values: names are trimmed 1-500, checkout reason may be an explicit null', () => {
  assert.deepEqual(parseProposedValue('firstName', '  Aarav '), { kind: 'text', value: 'Aarav' });
  assert.deepEqual(parseProposedValue('reason', null), { kind: 'null', value: null });
  bad(() => parseProposedValue('firstName', null));
  bad(() => parseProposedValue('firstName', 'x'.repeat(501)));
  bad(() => parseProposedValue('lastName', '   '));
});

test('age: whole IST calendar days from the earliest candidate; 90 is normal, 91 is exceptional', () => {
  const today = '2026-11-08';
  assert.equal(ageDays(['2026-08-10'], today), 90);
  assert.equal(isExceptional(90), false);
  assert.equal(ageDays(['2026-08-09'], today), 91);
  assert.equal(isExceptional(91), true);
  assert.equal(ageDays(['2026-11-08', '2026-08-11'], today), 89);
  assert.equal(ageDays(['2026-11-20'], today), 0, 'a future day clamps to 0');
  assert.equal(
    ageDays(['2026-11-08', '2021-11-08'], today),
    1826,
    'a recent effectiveAt cannot hide an old anchor',
  );
});

test('IST day boundary does not depend on the host time zone', () => {
  assert.equal(istDayKeyOf(new Date('2026-11-08T18:29:59.999Z')), '2026-11-08');
  assert.equal(istDayKeyOf(new Date('2026-11-08T18:30:00.000Z')), '2026-11-09');
});

test('evidence: always for a price, for exceptional, and for historical financial/occupancy; optional for in-window names', () => {
  assert.equal(
    evidenceRequired({ fieldKey: 'monthlyPrice', historical: false, exceptional: false }),
    true,
  );
  assert.equal(
    evidenceRequired({ fieldKey: 'firstName', historical: true, exceptional: false }),
    false,
  );
  assert.equal(
    evidenceRequired({ fieldKey: 'firstName', historical: true, exceptional: true }),
    true,
  );
  assert.equal(
    evidenceRequired({ fieldKey: 'checkOutAt', historical: true, exceptional: false }),
    true,
  );
  assert.equal(
    evidenceRequired({ fieldKey: 'startDate', historical: false, exceptional: false }),
    false,
  );
});

test('reviewer authority: financial and exceptional are OWNER-only; normal non-financial is any independent operator', () => {
  assert.equal(reviewerRoleAllowed('PROPERTY_MANAGER', { financialImpact: false }, false), true);
  assert.equal(reviewerRoleAllowed('PROPERTY_MANAGER', { financialImpact: true }, false), false);
  assert.equal(reviewerRoleAllowed('PROPERTY_MANAGER', { financialImpact: false }, true), false);
  assert.equal(reviewerRoleAllowed('OWNER', { financialImpact: true }, true), true);
  assert.equal(reviewerRoleAllowed('VIEWER', { financialImpact: false }, false), false);
});

test('snapshot: only captured facts are compared; the first difference names its dependency group', () => {
  const expected = { 'RESIDENT_FIELD:firstName': 'Arahv' };
  assert.equal(
    diffSnapshot(expected, { 'RESIDENT_FIELD:firstName': 'Arahv', 'OTHER:x': 'changed' }),
    null,
  );
  assert.equal(diffSnapshot(expected, { 'RESIDENT_FIELD:firstName': 'Arav' }), 'RESIDENT_FIELD');
  const booking = { 'BOOKING_TERMS:startDate': 'a', 'ADMISSION:id': null, 'CHECK_IN:id': null };
  assert.equal(
    diffSnapshot(booking, { ...booking, 'ADMISSION:id': 'new-admission' }),
    'ADMISSION',
    'a new child row is a captured change',
  );
  assert.equal(diffSnapshot(booking, { ...booking }), null);
});

test('request check: deterministic over key order, bound to action/proposal/tenant/actor/payload, keyed', () => {
  const base = {
    action: 'APPROVE',
    proposalId: 'p1',
    organizationId: 'o',
    actorId: 'a',
    payload: { b: 1, a: 'x' },
  };
  const secret = 's'.repeat(32);
  assert.equal(canonicalJson({ b: 1, a: 'x' }), canonicalJson({ a: 'x', b: 1 }));
  assert.equal(
    requestCheck(secret, base),
    requestCheck(secret, { ...base, payload: { a: 'x', b: 1 } }),
  );
  assert.match(requestCheck(secret, base), /^[0-9a-f]{64}$/);
  for (const change of [
    { action: 'REJECT' },
    { proposalId: 'p2' },
    { organizationId: 'o2' },
    { actorId: 'a2' },
    { payload: { a: 'y', b: 1 } },
  ]) {
    assert.notEqual(requestCheck(secret, base), requestCheck(secret, { ...base, ...change }));
  }
  assert.notEqual(
    requestCheck(secret, base),
    requestCheck('t'.repeat(32), base),
    'depends on the server secret',
  );
});

// ----------------------------------------------------------------------------- error classification

test('failure classification reads exact SQLSTATE codes from the driver error, never message text', () => {
  const wrap = (originalCode: string, outer = 'P2034') => ({
    code: outer,
    meta: { driverAdapterError: { cause: { originalCode } } },
  });
  assert.equal(classifyFailure(wrap('40P01')), 'DEADLOCK');
  assert.equal(classifyFailure(wrap('40001')), 'SERIALIZATION');
  assert.equal(classifyFailure(wrap('55P03', 'P2010')), 'LOCK_TIMEOUT');
  assert.equal(classifyFailure({ cause: { originalCode: '55P03' } }), 'LOCK_TIMEOUT');
  assert.equal(classifyFailure({ code: '23505' }), 'UNIQUE_VIOLATION');
  assert.equal(classifyFailure({ code: 'P2028' }), 'UNCERTAIN');
  assert.equal(classifyFailure({ code: 'ECONNRESET', message: 'x' }), 'UNCERTAIN');
  assert.equal(classifyFailure(wrap('57014')), 'UNCERTAIN');
  assert.equal(classifyFailure(new Error('deadlock detected')), 'OTHER');
  assert.equal(
    classifyFailure({ code: 'P2034' }),
    'OTHER',
    'a Prisma code alone is not a SQLSTATE',
  );
  assert.deepEqual(
    sqlStates({
      code: 'P2034',
      meta: { driverAdapterError: { cause: { originalCode: '40P01' } } },
    }),
    ['40P01'],
  );
});

test('only deadlock and serialization failure are auto-retryable', () => {
  assert.equal(isAutoRetryable('DEADLOCK'), true);
  assert.equal(isAutoRetryable('SERIALIZATION'), true);
  for (const f of ['LOCK_TIMEOUT', 'UNCERTAIN', 'UNIQUE_VIOLATION', 'OTHER'] as const)
    assert.equal(isAutoRetryable(f), false);
});

// ---------------------------------------------------------------------------------- the shared gate

test('gate: one helper sets a transaction-local lock_timeout, then takes the exclusive transaction-level advisory lock', async () => {
  const statements: { text: string; values: unknown[] }[] = [];
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({ text: strings.join('?'), values });
      return 0;
    },
  };
  await acquireOrgGate(tx as any, 'org-1');
  assert.equal(statements.length, 2);
  assert.match(statements[0]!.text, /set_config\('lock_timeout'/);
  assert.match(statements[0]!.text, /, true\)/, 'transaction-local');
  assert.equal(statements[0]!.values[0], '3000ms');
  assert.match(statements[1]!.text, /pg_advisory_xact_lock\(/);
  assert.ok(!/_shared/.test(statements[1]!.text), 'exclusive only; no shared mode, so no upgrade');
  assert.equal(statements[1]!.values[0], orgGateKeyText('org-1'));
  assert.notEqual(orgGateKeyText('org-1'), orgGateKeyText('org-2'));
  assert.ok(
    !orgGateKeyText('org-1').startsWith('invoice-number:') &&
      !orgGateKeyText('org-1').startsWith('payment-idempotency:'),
  );
});

test('transaction options are explicit and distinct from lock_timeout; ordinary writers are shorter than corrections', () => {
  assert.deepEqual(ORDINARY_TX_OPTIONS, { maxWait: 5_000, timeout: 15_000 });
  assert.deepEqual(CORRECTION_TX_OPTIONS, { maxWait: 10_000, timeout: 30_000 });
});
