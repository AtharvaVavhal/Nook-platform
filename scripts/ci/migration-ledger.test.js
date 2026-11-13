import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyLedger,
  verifyFreshLedger,
  verifyLedgerSchema,
  LEDGER_COLUMNS,
} from './migration-ledger.js';

const expected = JSON.parse(
  readFileSync(new URL('./g6b-migrations.json', import.meta.url)),
).migrations;
export const goodRows = () =>
  expected.map((m, i) => ({
    id: `migration-${i}`,
    migration_name: m.name,
    checksum: m.checksum,
    started_at: String(1000000 + i * 10),
    finished_at: String(1000005 + i * 10),
    rolled_back_at: null,
    logs: null,
    applied_steps_count: 1,
  }));
export const goodMetadata = () => ({
  relation: {
    schema: 'public',
    name: '_prisma_migrations',
    kind: 'r',
    owner: 'nook_ci_full_migrator',
  },
  columns: Object.entries(LEDGER_COLUMNS).map(([name, [type, length, nullable]]) => ({
    name,
    type,
    length,
    nullable,
    default: name === 'started_at' ? 'now()' : name === 'applied_steps_count' ? '0' : null,
  })),
  primaryKey: ['id'],
});

test('all 24 exact successes, independent of query return order', () =>
  assert.equal(verifyFreshLedger(goodRows().reverse(), expected).size, 24));
for (const [name, mutate] of [
  ['missing', (r) => r.pop()],
  ['unexpected', (r) => (r[0].migration_name = 'unknown')],
  ['checksum', (r) => (r[0].checksum = '0'.repeat(64))],
  ['checksum format', (r) => (r[0].checksum = 'oops')],
  ['duplicate success', (r) => r.push({ ...r[0], id: 'another' })],
  ['duplicate ID', (r) => (r[1].id = r[0].id)],
  ['empty ID', (r) => (r[0].id = '')],
  ['unfinished', (r) => (r[0].finished_at = null)],
  [
    'failure logs',
    (r) => {
      r[0].finished_at = null;
      r[0].logs = 'synthetic failure';
    },
  ],
  ['successful logs', (r) => (r[0].logs = 'synthetic failure')],
  [
    'rollback only',
    (r) => {
      r[0].finished_at = null;
      r[0].rolled_back_at = '1000006';
    },
  ],
  ['contradictory terminal states', (r) => (r[0].rolled_back_at = '1000006')],
  ['null start', (r) => (r[0].started_at = null)],
  ['missing field', (r) => delete r[0].logs],
  ['invalid timestamp', (r) => (r[0].finished_at = 'invalid')],
  ['out of PostgreSQL range', (r) => (r[0].finished_at = '99999999999999999999')],
  ['infinity', (r) => (r[0].finished_at = 'Infinity')],
  ['Date coercion', (r) => (r[0].started_at = new Date())],
  ['terminal before start', (r) => (r[0].finished_at = '0')],
  ['out of order', (r) => (r[1].started_at = '1')],
  ['negative steps', (r) => (r[0].applied_steps_count = -1)],
  ['fractional steps', (r) => (r[0].applied_steps_count = 1.5)],
  ['null steps', (r) => (r[0].applied_steps_count = null)],
  ['zero fresh steps', (r) => (r[0].applied_steps_count = 0)],
])
  test(`reject ledger: ${name}`, () => {
    const rows = goodRows();
    mutate(rows);
    assert.throws(() => verifyFreshLedger(rows, expected));
  });
test('microsecond ordering is exact and equal boundaries are allowed', () => {
  const rows = goodRows();
  rows[1].started_at = rows[0].finished_at;
  verifyFreshLedger(rows, expected);
  rows[1].started_at = String(BigInt(rows[0].finished_at) - 1n);
  assert.throws(() => verifyFreshLedger(rows, expected));
});
test('recognizes resolved failed attempt and successful retry, but fresh policy rejects it', () => {
  const rows = goodRows();
  rows.push({
    ...rows[0],
    id: 'historical',
    started_at: '999990',
    finished_at: null,
    rolled_back_at: '999999',
    logs: 'original failure',
    applied_steps_count: 0,
    checksum: 'a'.repeat(64),
  });
  const groups = classifyLedger(rows, expected);
  assert.equal(groups.get(expected[0].name).history[0].logs, 'original failure');
  assert.throws(() => verifyFreshLedger(rows, expected));
});
test('reject rollback timestamp before attempt', () => {
  const rows = goodRows();
  rows.push({ ...rows[0], id: 'bad', finished_at: null, rolled_back_at: '1' });
  assert.throws(() => classifyLedger(rows, expected));
});
test('reject history resolved after successful retry', () => {
  const rows = goodRows();
  rows.push({ ...rows[0], id: 'bad', finished_at: null, rolled_back_at: '1000006' });
  assert.throws(() => classifyLedger(rows, expected));
});
test('ledger schema matches pinned PostgreSQL definition', () =>
  verifyLedgerSchema(goodMetadata(), 'nook_ci_full_migrator'));
for (const [name, mutate] of [
  ['wrong schema', (m) => (m.relation.schema = 'other')],
  ['wrong owner', (m) => (m.relation.owner = 'runtime')],
  ['view instead of table', (m) => (m.relation.kind = 'v')],
  ['missing column', (m) => m.columns.pop()],
  ['duplicate column', (m) => (m.columns[1] = m.columns[0])],
  ['wrong column type', (m) => (m.columns[0].type = 'text')],
  ['wrong nullable', (m) => (m.columns[0].nullable = true)],
  ['wrong length', (m) => (m.columns[0].length = 255)],
  ['wrong default', (m) => (m.columns.at(-1).default = null)],
  ['missing PK', (m) => (m.primaryKey = [])],
])
  test(`reject ledger catalog: ${name}`, () => {
    const m = goodMetadata();
    mutate(m);
    assert.throws(() => verifyLedgerSchema(m, 'nook_ci_full_migrator'));
  });

test('timestamp outside PostgreSQL finite range fails closed', () => {
  const rows = goodRows();
  rows[0].finished_at = '99999999999999999999';
  assert.throws(() => verifyFreshLedger(rows, expected));
});
