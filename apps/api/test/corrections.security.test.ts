import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { defaultCorrectionsConfig } from '../src/corrections/corrections.service.js';

/** Static and configuration guards for the P4-2 security and finance review. Executed behaviour is in the integration suite. */
const SRC = new URL('../src/', import.meta.url).pathname;
const CORRECTIONS = join(SRC, 'corrections');
const source = (path: string) => readFileSync(path, 'utf8');
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('financial application is OFF by default and only the exact value 1 turns it on', () => {
  const saved = process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED;
  try {
    delete process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED;
    assert.equal(defaultCorrectionsConfig.financialApplyEnabled(), false, 'unset is OFF');
    for (const value of ['', '0', 'false', 'true', 'yes', 'on', ' 1', '1 ', '01', 'TRUE']) {
      process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED = value;
      assert.equal(defaultCorrectionsConfig.financialApplyEnabled(), false, `"${value}" is OFF`);
    }
    process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED = '1';
    assert.equal(defaultCorrectionsConfig.financialApplyEnabled(), true);
  } finally {
    if (saved === undefined) delete process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED;
    else process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED = saved;
  }
});

test('no deployment file or example configuration enables financial application', () => {
  const roots = [
    '../../../.env.example',
    '../../../apps/api/.env.example',
    '../../../railway.json',
    '../../../render.yaml',
  ];
  for (const relative of roots) {
    let text = '';
    try {
      text = readFileSync(new URL(relative, import.meta.url), 'utf8');
    } catch {
      continue; // the file does not exist in this repository
    }
    assert.doesNotMatch(
      text,
      /CORRECTIONS_FINANCIAL_APPLY_ENABLED\s*[=:]\s*["']?1/,
      `${relative} must not enable financial application`,
    );
  }
});

test('the Resident row is never locked with FOR UPDATE on the correction path (Resident -> Invoice ordering)', () => {
  for (const name of readdirSync(CORRECTIONS).filter((n) => n.endsWith('.ts'))) {
    const code = strip(source(join(CORRECTIONS, name)));
    // A strong Resident lock would conflict with the invoice-first lock order of payments, reversals, adjustments and voids.
    for (const match of code.matchAll(/FROM residents[\s\S]{0,300}?(FOR [A-Z ]*UPDATE)/g)) {
      assert.equal(
        match[1],
        'FOR NO KEY UPDATE',
        `${name}: residents may only use FOR NO KEY UPDATE`,
      );
    }
    assert.doesNotMatch(
      code,
      /lockRow\([^)]*'residents'/,
      `${name} takes a Resident row lock through lockRow`,
    );
  }
});

test('the documented lock order is encoded once, in order: Bed, Booking, Admission, CheckIn, CheckOut', () => {
  const facts = strip(source(join(CORRECTIONS, 'corrections.facts.ts')));
  const union = facts.match(/type LockTable = ([^;]+);/)![1]!;
  assert.deepEqual(
    [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    ['beds', 'bookings', 'admissions', 'check_ins', 'check_outs'],
  );
  const calls = [...facts.matchAll(/lockRow\(tx, organizationId, '([a-z_]+)'/g)].map((m) => m[1]);
  const rank = ['beds', 'bookings', 'admissions', 'check_ins', 'check_outs'];
  const firstChain = calls.slice(0, 5);
  assert.deepEqual(
    firstChain,
    rank.filter((table) => firstChain.includes(table)),
    'row locks are taken in the documented order',
  );
});

test('the correction controller never lets the body or query choose tenant or actor', () => {
  const controller = strip(source(join(CORRECTIONS, 'corrections.controller.ts')));
  assert.match(controller, /organizationId: req\.auth!\.organizationId/);
  assert.match(controller, /userId: req\.auth!\.userId/);
  assert.match(controller, /role: req\.auth!\.role/);
  assert.doesNotMatch(controller, /body\.(organizationId|userId|requestedBy|decidedBy|role)/);
  assert.doesNotMatch(controller, /query\.(organizationId|userId|requestedBy|decidedBy)/);
});

test('sign-in throttling is the committed implementation: lockedUntil queries the database and does not return a constant', () => {
  const text = strip(source(join(SRC, 'auth/throttle.service.ts')));
  const method = text.slice(
    text.indexOf('async lockedUntil'),
    text.indexOf('async ', text.indexOf('async lockedUntil') + 10),
  );
  assert.match(method, /loginThrottle\.findMany/);
  assert.match(method, /lockedUntil: \{ gt: new Date\(\) \}/);
  assert.doesNotMatch(method, /TEMPORARILY|DISABLED|bypass/i);
  assert.doesNotMatch(text, /TEMPORARILY DISABLED|bypasses sign-in throttling/i);
});
