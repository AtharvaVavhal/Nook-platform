import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FOUNDATION, assertG6AAuthorization, deployFoundation } from './g6a-migration.js';
import { INITIAL_MIGRATION_TABLES } from '../../apps/api/test/integration/helpers/guard.ts';

const source = readFileSync(`prisma/migrations/${FOUNDATION}/migration.sql`);
const goodRow = () => ({
  migration_name: FOUNDATION,
  checksum: createHash('sha256').update(source).digest('hex'),
  started_at: new Date('2026-11-05T00:00:00Z'),
  finished_at: new Date('2026-11-05T00:01:00Z'),
  rolled_back_at: null,
  applied_steps_count: 1,
  logs: null,
});

function harness({
  rows = [goodRow()],
  tables = INITIAL_MIGRATION_TABLES,
  dirty = false,
  result = { status: 0 },
} = {}) {
  const queries = [];
  const messages = [];
  let directory;
  let calls = 0;
  const owner = {
    query: async (sql) => {
      queries.push(sql);
      assert.match(sql, /^SELECT /, 'No SQL migration execution in initial path');
      if (queries.length === 1) return { rows: dirty ? [{ tablename: 'existing' }] : [] };
      if (sql.includes('FROM public._prisma_migrations')) return { rows };
      return { rows: tables.map((tablename) => ({ tablename })) };
    },
  };
  const run = (executable, args, options) => {
    calls += 1;
    assert.equal(executable, process.execPath);
    assert.match(args[0], /node_modules\/prisma\/build\/index\.js$/);
    assert.deepEqual(args.slice(1, 4), ['migrate', 'deploy', '--config']);
    assert.ok(args[4].endsWith('/scripts/ci/g6a-prisma.config.ts'));
    assert.deepEqual(Object.keys(options.env).sort(), [
      'DATABASE_URL',
      'NOOK_CI_G6A_MIGRATIONS_DIR',
      'PATH',
    ]);
    assert.equal(options.env.DATABASE_URL, 'mock-migrator-target');
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    directory = options.env.NOOK_CI_G6A_MIGRATIONS_DIR;
    assert.deepEqual(readdirSync(directory).sort(), [FOUNDATION, 'migration_lock.toml']);
    assert.deepEqual(readdirSync(join(directory, FOUNDATION)), ['migration.sql']);
    assert.deepEqual(readFileSync(join(directory, FOUNDATION, 'migration.sql')), source);
    assert.deepEqual(
      readFileSync(join(directory, 'migration_lock.toml')),
      readFileSync('prisma/migrations/migration_lock.toml'),
    );
    return result;
  };
  return {
    execute: () =>
      deployFoundation(owner, 'mock-migrator-target', {
        run,
        report: (message) => messages.push(message),
      }),
    queries,
    messages,
    calls: () => calls,
    cleaned: () => directory === undefined || !existsSync(directory),
  };
}

test('deploys only unchanged foundation through locked Prisma, verifies ledger/schema, cleans staging', async () => {
  const h = harness();
  await h.execute();
  assert.equal(h.calls(), 1);
  assert.equal(h.queries.length, 3);
  assert.equal(h.messages.length, 3);
  assert.ok(h.cleaned());
});

for (const [name, row] of [
  ['wrong migration', { migration_name: 'later_migration' }],
  ['checksum mismatch', { checksum: 'incorrect' }],
  ['unfinished', { finished_at: null }],
  ['not started', { started_at: null }],
  ['invalid completion timestamp', { finished_at: 'invalid' }],
  ['rolled back', { rolled_back_at: new Date() }],
  ['no applied steps', { applied_steps_count: 0 }],
  ['error log present', { logs: 'mock failure' }],
]) {
  test(`refuses ledger: ${name}`, async () => {
    const h = harness({ rows: [{ ...goodRow(), ...row }] });
    await assert.rejects(h.execute());
    assert.equal(h.calls(), 1);
    assert.ok(h.queries.length >= 2);
    assert.ok(h.cleaned());
  });
}
for (const rows of [[], [goodRow(), goodRow()]]) {
  test(`refuses ledger count ${rows.length}`, async () => {
    const h = harness({ rows });
    await assert.rejects(h.execute());
    assert.equal(h.calls(), 1);
    assert.ok(h.queries.length >= 2);
    assert.ok(h.cleaned());
  });
}
for (const tables of [
  INITIAL_MIGRATION_TABLES.slice(1),
  [...INITIAL_MIGRATION_TABLES, 'invoices'],
]) {
  test(`refuses wrong application table set (${tables.length} tables)`, async () => {
    const h = harness({ tables });
    await assert.rejects(h.execute());
    assert.equal(h.calls(), 1);
    assert.ok(h.queries.length >= 2);
    assert.ok(h.cleaned());
  });
}
for (const result of [
  { status: 1, stderr: 'mock-secret' },
  { status: null, signal: 'SIGTERM' },
  { status: 0, error: new Error('mock-secret') },
]) {
  test('deployment failure stops verification and never relays raw output', async () => {
    const h = harness({ result });
    await assert.rejects(h.execute(), (error) => !error.message.includes('mock-secret'));
    assert.equal(h.queries.length, 1);
    assert.deepEqual(h.messages, []);
    assert.ok(h.cleaned());
  });
}
test('rejects an already populated database without invoking Prisma', async () => {
  const h = harness({ dirty: true });
  await assert.rejects(h.execute());
  assert.equal(h.calls(), 0);
});

const authorized = {
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_JOB: 'initial-integration',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_WORKFLOW_REF: 'AtharvaVavhal/Nook-platform/.github/workflows/g6a.yml@refs/heads/review',
  NOOK_CI_G6A_AUTHORIZATION: 'AUTHORIZE_G6A',
};
test('accepts the dedicated authorization contract with mock metadata only', () => {
  assert.doesNotThrow(() => assertG6AAuthorization(authorized));
});
for (const key of Object.keys(authorized)) {
  test(`rejects missing/incorrect authorization metadata: ${key}`, () => {
    assert.throws(() => assertG6AAuthorization({ ...authorized, [key]: undefined }));
    assert.throws(() => assertG6AAuthorization({ ...authorized, [key]: 'wrong' }));
  });
}
