import assert from 'node:assert/strict';

export const LEDGER_COLUMNS = {
  id: ['character varying', 36, false],
  checksum: ['character varying', 64, false],
  migration_name: ['character varying', 255, false],
  started_at: ['timestamp with time zone', null, false],
  finished_at: ['timestamp with time zone', null, true],
  rolled_back_at: ['timestamp with time zone', null, true],
  logs: ['text', null, true],
  applied_steps_count: ['integer', null, false],
};

export function verifyLedgerSchema({ relation, columns, primaryKey }, owner) {
  assert.deepEqual(relation, { schema: 'public', name: '_prisma_migrations', kind: 'r', owner });
  assert.deepEqual(primaryKey, ['id']);
  assert.equal(columns.length, 8);
  const seen = new Set();
  for (const c of columns) {
    assert.ok(!seen.has(c.name) && Object.hasOwn(LEDGER_COLUMNS, c.name));
    seen.add(c.name);
    assert.deepEqual([c.type, c.length, c.nullable], LEDGER_COLUMNS[c.name]);
    if (c.name === 'started_at') assert.equal(c.default, 'now()');
    else if (c.name === 'applied_steps_count') assert.equal(c.default, '0');
    else assert.equal(c.default, null);
  }
}

// Adapter returns PostgreSQL epoch microseconds as strings: no JS Date precision loss.
function timestamp(value) {
  assert.ok(typeof value === 'string' && /^-?\d{1,20}$/.test(value), 'Invalid ledger timestamp');
  const micros = BigInt(value);
  assert.ok(
    micros >= -210866803200000000n && micros <= 9224318015999999999n,
    'Timestamp outside PostgreSQL finite range',
  );
  return micros;
}

export function classifyLedger(rows, expected) {
  assert.ok(Array.isArray(rows));
  const groups = new Map(expected.map((m) => [m.name, { expected: m, success: [], history: [] }]));
  assert.equal(groups.size, expected.length);
  const ids = new Set();
  for (const row of rows) {
    for (const key of Object.keys(LEDGER_COLUMNS)) assert.ok(Object.hasOwn(row, key));
    assert.ok(typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 36);
    assert.ok(!ids.has(row.id), 'Duplicate ledger ID');
    ids.add(row.id);
    assert.ok(
      typeof row.migration_name === 'string' && groups.has(row.migration_name),
      'Unexpected migration',
    );
    assert.match(row.checksum, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(row.applied_steps_count) && row.applied_steps_count >= 0);
    assert.ok(row.logs === null || typeof row.logs === 'string');
    const start = timestamp(row.started_at);
    const finish = row.finished_at === null ? null : timestamp(row.finished_at);
    const rollback = row.rolled_back_at === null ? null : timestamp(row.rolled_back_at);
    assert.ok(finish === null || finish >= start);
    assert.ok(rollback === null || rollback >= start);
    assert.ok(!(finish !== null && rollback !== null), 'Contradictory ledger state');
    assert.ok(finish !== null || rollback !== null, 'Unresolved migration attempt');
    const group = groups.get(row.migration_name);
    if (finish !== null) {
      assert.equal(row.checksum, group.expected.checksum);
      assert.ok(row.logs === null || row.logs === '', 'Successful migration has error logs');
      group.success.push(row);
    } else group.history.push(row); // Preserve resolved failures, including their logs/checksum.
  }
  let previous;
  for (const group of groups.values()) {
    assert.equal(group.success.length, 1, 'Missing or duplicate successful migration');
    const success = group.success[0];
    const history = [...group.history].sort((a, b) =>
      timestamp(a.started_at) < timestamp(b.started_at) ? -1 : 1,
    );
    let end;
    for (const row of history) {
      if (end !== undefined)
        assert.ok(end <= timestamp(row.started_at), 'Overlapping retry history');
      end = timestamp(row.rolled_back_at);
      assert.ok(end <= timestamp(success.started_at), 'Rollback follows successful retry');
    }
    if (previous !== undefined)
      assert.ok(previous <= timestamp(success.started_at), 'Migration sequence mismatch');
    previous = timestamp(success.finished_at);
  }
  return groups;
}

export function verifyFreshLedger(rows, expected) {
  const groups = classifyLedger(rows, expected);
  for (const group of groups.values()) {
    assert.equal(group.history.length, 0, 'Fresh deployment contains recovery history');
    assert.ok(
      group.success[0].applied_steps_count > 0,
      'Fresh deployment lacks execution metadata',
    );
  }
  return groups;
}
