import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CommandKeys,
  FIELD_OPTIONS,
  adviceFor,
  commandSignature,
  evidenceLikelyRequired,
  fieldsFor,
  keepsKey,
  optionFor,
  proposedPayload,
  toZonedInstant,
  validateProposed,
  valueText,
  type KeyStorage,
} from './correctionRules';
import { correctionsLinks, isOpsHash, parseOpsRoute } from './opsRoute';

const ID = '11111111-1111-4111-8111-111111111111';

function memoryStorage(): KeyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

test('every allowlisted field has exactly one option and the nine fields are the only ones offered', () => {
  assert.deepEqual(
    FIELD_OPTIONS.map((f) => f.field),
    [
      'firstName',
      'lastName',
      'startDate',
      'endDate',
      'monthlyPrice',
      'admissionDate',
      'checkInAt',
      'checkOutAt',
      'reason',
    ],
  );
  assert.deepEqual(
    fieldsFor('CHECK_OUT').map((f) => f.field),
    ['checkOutAt', 'reason'],
  );
  assert.equal(optionFor('phone'), undefined, 'phone/email are not correction fields');
  assert.equal(optionFor('email'), undefined);
});

test('date-time input is Asia/Kolkata wall-clock time sent with an explicit zone', () => {
  assert.equal(toZonedInstant('2026-11-08T09:30'), '2026-11-08T09:30:00+05:30');
  assert.equal(toZonedInstant('2026-11-08T09:30:15'), '2026-11-08T09:30:15+05:30');
  assert.throws(() => toZonedInstant('08/11/2026 9:30'));
});

test('validation: names and amounts follow the server rules; an empty checkout reason clears it', () => {
  const first = optionFor('firstName')!;
  assert.equal(validateProposed(first, '   '), 'Enter the corrected value.');
  assert.equal(validateProposed(first, 'Aarav'), null);
  assert.ok(validateProposed(first, 'x'.repeat(501)));
  const price = optionFor('monthlyPrice')!;
  for (const bad of ['0', '-1', '8,500', '1.234', '100000000'])
    assert.ok(validateProposed(price, bad), bad);
  for (const good of ['8500', '8500.5', '99999999.99'])
    assert.equal(validateProposed(price, good), null, good);
  const reason = optionFor('reason')!;
  assert.equal(validateProposed(reason, ''), null);
  assert.equal(proposedPayload(reason, '  '), null, 'empty means an explicit null');
  assert.equal(proposedPayload(first, ' Aarav '), 'Aarav');
});

test('evidence is flagged as usually required for a price and every financial or occupancy field, not for names', () => {
  assert.equal(evidenceLikelyRequired('monthlyPrice'), true);
  assert.equal(evidenceLikelyRequired('checkOutAt'), true);
  assert.equal(evidenceLikelyRequired('firstName'), false);
  assert.equal(evidenceLikelyRequired('reason'), false);
});

test('stored values render with their type; a proposed value is a value, not a verdict', () => {
  assert.equal(valueText({ kind: 'money', value: '8500.00' }), '₹8500.00');
  assert.equal(
    valueText({ kind: 'instant', value: '2026-11-08T04:00:15.123456Z' }),
    '2026-11-08 09:30 IST',
  );
  assert.equal(valueText({ kind: 'null', value: null }), 'Empty');
  assert.equal(valueText(null), '—');
  assert.equal(valueText({ kind: 'date', value: '2026-11-08' }), '2026-11-08');
});

test('idempotency key: the same command keeps one key across retries and reloads; a different command gets its own', () => {
  const storage = memoryStorage();
  let n = 0;
  const gen = () => `key-${++n}`;
  const a = new CommandKeys(storage, gen);
  const sig = commandSignature(['approve', ID, 'note']);
  const first = a.keyFor(sig);
  assert.equal(a.keyFor(sig), first, 'a retry re-sends the same key');
  assert.equal(new CommandKeys(storage, gen).keyFor(sig), first, 'a page reload keeps it too');
  assert.notEqual(a.keyFor(commandSignature(['approve', ID, 'another note'])), first);
  a.clear(sig);
  assert.notEqual(a.keyFor(sig), first, 'after a definitive answer the next command is new');
});

test('idempotency key: unavailable storage never breaks the screen (in-memory only)', () => {
  const broken: KeyStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  const keys = new CommandKeys(broken, () => 'k');
  assert.equal(keys.keyFor('s'), 'k');
  assert.equal(keys.keyFor('s'), 'k');
  keys.clear('s');
  assert.equal(new CommandKeys(null, () => 'z').keyFor('s'), 'z');
});

test('server answers: only a network failure or RETRY_REQUIRED keeps the key; STALE means a NEW proposal', () => {
  const network = adviceFor(0, undefined, 'Could not reach the server');
  assert.equal(network.kind, 'retry-same-key');
  assert.equal(keepsKey(network), true);
  assert.equal(keepsKey(adviceFor(409, 'RETRY_REQUIRED', 'busy')), true);
  const stale = adviceFor(409, 'STALE_SOURCE', 'x');
  assert.equal(stale.kind, 'new-proposal');
  assert.equal(keepsKey(stale), false);
  assert.match(stale.message, /submit a new correction/i);
  for (const code of [
    'LIFECYCLE_CONFLICT',
    'FINANCE_CONFLICT',
    'PENDING_CONFLICT',
    'INVALID_STATE',
    'EVIDENCE_REQUIRED',
  ]) {
    assert.equal(keepsKey(adviceFor(409, code, 'm')), false, code);
  }
  assert.equal(
    adviceFor(403, 'SELF_REVIEW', 'You cannot review your own correction').kind,
    'denied',
  );
  assert.equal(adviceFor(400, 'INVALID_VALUE', 'bad').kind, 'fix-input');
});

test('routes: corrections screens parse, a prefilled request keeps its query out of the route, ids must be UUIDs', () => {
  assert.deepEqual(parseOpsRoute('#corrections'), { name: 'corrections' });
  assert.deepEqual(parseOpsRoute('#corrections/new'), { name: 'correction-new' });
  assert.deepEqual(parseOpsRoute(`#corrections/new?targetType=RESIDENT&targetId=${ID}`), {
    name: 'correction-new',
  });
  assert.deepEqual(parseOpsRoute(`#corrections/${ID}`), { name: 'correction', id: ID });
  assert.deepEqual(parseOpsRoute('#corrections/finance-reviews'), { name: 'finance-reviews' });
  assert.deepEqual(parseOpsRoute('#corrections/not-a-uuid'), { name: 'corrections' });
  assert.equal(isOpsHash('#corrections'), true);
  assert.equal(isOpsHash(`#corrections/${ID}`), true);
  assert.equal(
    correctionsLinks.new({ targetType: 'RESIDENT', targetId: ID, field: 'firstName' }),
    `#corrections/new?targetType=RESIDENT&targetId=${ID}&field=firstName`,
  );
  assert.equal(correctionsLinks.new(), '#corrections/new');
});
