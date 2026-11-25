import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_BATCH_SIZE,
  RETENTION_LOCK_KEY,
  RETENTION_POLICY,
  RETENTION_TARGETS,
  cutoffFor,
  deleteBatchSql,
  countSql,
  runRetention,
  type QueryResult,
  type RetentionExecutor,
} from '../src/resident-retention/retention.js';

// Database-free unit tests. They prove cutoff arithmetic, batching, locking, dry-run, failure handling and that the SQL touches
// only the three approved tables. They cannot prove which rows a predicate selects: that needs a database and is PENDING.

const NOW = new Date('2026-12-01T00:00:00.000Z');
const DAY = 86_400_000;

interface Call {
  text: string;
  values: readonly unknown[];
}

function fake(script: (call: Call, index: number) => Partial<QueryResult> | Error) {
  const calls: Call[] = [];
  const executor: RetentionExecutor = {
    async query(text, values = []) {
      const call = { text, values };
      calls.push(call);
      const out = script(call, calls.length - 1);
      if (out instanceof Error) throw out;
      return { rowCount: out.rowCount ?? 0, rows: out.rows ?? [] };
    },
  };
  return { executor, calls };
}

const lockOk = (call: Call) =>
  call.text.includes('pg_try_advisory_lock') ? { rows: [{ locked: true }] } : undefined;

test('retention policy is exactly the approved one', () => {
  assert.deepEqual(RETENTION_POLICY, { otpChallengeDays: 7, sessionDays: 30, throttleDays: 1 });
  assert.deepEqual(
    RETENTION_TARGETS.map((t) => [t.name, t.table, t.days]),
    [
      ['otp_challenges', 'resident_otp_challenges', 7],
      ['sessions', 'resident_sessions', 30],
      ['throttles', 'resident_auth_throttles', 1],
    ],
  );
});

test('cutoffs are explicit: now minus the retention days, per table', async () => {
  assert.equal(cutoffFor(NOW, 7).getTime(), NOW.getTime() - 7 * DAY);
  const { executor, calls } = fake((c) => lockOk(c) ?? { rowCount: 0 });
  const report = await runRetention(executor, { now: NOW, dryRun: false });
  const deletes = calls.filter((c) => c.text.startsWith('DELETE'));
  assert.equal(deletes.length, 3);
  assert.deepEqual(
    deletes.map((c) => (c.values[0] as Date).getTime()),
    [NOW.getTime() - 7 * DAY, NOW.getTime() - 30 * DAY, NOW.getTime() - 1 * DAY],
  );
  assert.deepEqual(
    report.targets.map((t) => t.cutoff),
    [7, 30, 1].map((d) => new Date(NOW.getTime() - d * DAY).toISOString()),
  );
});

test('predicates keep live rows: they select only on past-due time columns and never on status alone', () => {
  const [otp, sessions, throttles] = RETENTION_TARGETS;
  assert.equal(otp!.predicate, 'expires_at < $1');
  assert.match(
    sessions!.predicate,
    /LEAST\(COALESCE\(revoked_at, 'infinity'::timestamptz\), idle_expires_at, absolute_expires_at\) < \$1/,
  );
  assert.match(throttles!.predicate, /GREATEST\(window_started_at \+/);
  assert.match(throttles!.predicate, /COALESCE\(locked_until, window_started_at\)\) < \$1/);
  // every counting scope's window comes from the policy, and the cooldown scope (a timed lock only) falls back to 0
  for (const s of [
    'OTP_REQUEST_PHONE',
    'OTP_REQUEST_ADDRESS',
    'OTP_VERIFY_PHONE',
    'OTP_VERIFY_ADDRESS',
  ])
    assert.match(throttles!.predicate, new RegExp(`WHEN '${s}' THEN \\d+`));
  assert.match(throttles!.predicate, /ELSE 0 END/);
});

test('SQL touches only the three approved tables and can never delete audit events', () => {
  const allowed = new Set([
    'resident_otp_challenges',
    'resident_sessions',
    'resident_auth_throttles',
  ]);
  for (const t of RETENTION_TARGETS) {
    assert.ok(allowed.has(t.table));
    for (const sql of [deleteBatchSql(t), countSql(t)]) {
      assert.doesNotMatch(sql, /audit_events|TRUNCATE|DROP|ALTER|UPDATE|INSERT/i);
      assert.equal(
        sql.match(/FROM (\w+)/g)?.every((m) => allowed.has(m.slice(5))),
        true,
      );
    }
    const del = deleteBatchSql(t);
    assert.match(del, /WHERE/);
    assert.match(del, /LIMIT \$2/);
  }
});

test('deletion is bounded: batches stop at the batch size and at the batch limit, reporting what remains', async () => {
  const { executor, calls } = fake((c) => lockOk(c) ?? { rowCount: 2 });
  const report = await runRetention(executor, {
    now: NOW,
    dryRun: false,
    batchSize: 2,
    maxBatchesPerTarget: 3,
  });
  const per = report.targets[0]!;
  assert.equal(per.batches, 3);
  assert.equal(per.deleted, 6);
  assert.equal(per.moreRemain, true, 'full batches up to the limit mean more rows may remain');
  assert.ok(calls.filter((c) => c.text.startsWith('DELETE')).every((c) => c.values[1] === 2));
});

test('a short batch ends the table and nothing remains', async () => {
  let n = 0;
  const { executor } = fake((c) => lockOk(c) ?? { rowCount: n++ === 0 ? 2 : 1 });
  const report = await runRetention(executor, { now: NOW, dryRun: false, batchSize: 2 });
  assert.equal(report.targets[0]!.batches, 2);
  assert.equal(report.targets[0]!.deleted, 3);
  assert.equal(report.targets[0]!.moreRemain, false);
});

test('repeated execution is idempotent: a second pass over an empty set deletes nothing and reports ok', async () => {
  const { executor } = fake((c) => lockOk(c) ?? { rowCount: 0 });
  const a = await runRetention(executor, { now: NOW, dryRun: false });
  const b = await runRetention(executor, { now: NOW, dryRun: false });
  assert.deepEqual(a, b);
  assert.equal(a.ok, true);
  assert.equal(
    a.targets.reduce((s, t) => s + t.deleted, 0),
    0,
  );
});

test('dry run counts only: no DELETE is ever issued', async () => {
  const { executor, calls } = fake((c) => lockOk(c) ?? { rows: [{ n: 4 }] });
  const report = await runRetention(executor, { now: NOW, dryRun: true });
  assert.equal(
    calls.some((c) => c.text.startsWith('DELETE')),
    false,
  );
  assert.deepEqual(
    report.targets.map((t) => t.wouldDelete),
    [4, 4, 4],
  );
  assert.ok(report.targets.every((t) => t.deleted === 0));
});

test('overlap is prevented: when the advisory lock is held nothing runs; otherwise it is taken and released', async () => {
  const busy = fake((c) =>
    c.text.includes('pg_try_advisory_lock') ? { rows: [{ locked: false }] } : { rowCount: 9 },
  );
  const skipped = await runRetention(busy.executor, { now: NOW, dryRun: false });
  assert.equal(skipped.skipped, 'LOCK_HELD');
  assert.equal(busy.calls.length, 1, 'only the lock attempt is made');
  const free = fake((c) => lockOk(c) ?? { rowCount: 0 });
  await runRetention(free.executor, { now: NOW, dryRun: false });
  assert.match(free.calls[0]!.text, /pg_try_advisory_lock/);
  assert.equal(free.calls[0]!.values[0], RETENTION_LOCK_KEY);
  assert.match(free.calls.at(-1)!.text, /pg_advisory_unlock/);
});

test('a failing table is reported by SQLSTATE only, the lock is still released, and the other tables still run', async () => {
  const boom = Object.assign(new Error('relation "x" secret detail postgres://u:p@h/db'), {
    code: '42501',
  });
  const { executor, calls } = fake((c) => {
    if (c.text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (c.text.includes('FROM resident_sessions')) return boom;
    return { rowCount: 0 };
  });
  const report = await runRetention(executor, { now: NOW, dryRun: false });
  assert.equal(report.ok, false);
  assert.equal(report.targets.find((t) => t.name === 'sessions')!.error, '42501');
  assert.equal(report.targets.length, 3);
  assert.doesNotMatch(JSON.stringify(report), /secret|postgres:|relation/);
  assert.match(calls.at(-1)!.text, /pg_advisory_unlock/);
});

test('an unlock failure does not hide the report; unknown errors get a neutral code', async () => {
  const { executor } = fake((c) => {
    if (c.text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (c.text.includes('pg_advisory_unlock')) return new Error('connection lost');
    return new Error('weird');
  });
  const report = await runRetention(executor, { now: NOW, dryRun: false });
  assert.equal(report.ok, false);
  assert.ok(report.targets.every((t) => t.error === 'UNKNOWN'));
});

test('invalid options are refused before any query', async () => {
  const { executor, calls } = fake(() => ({}));
  await assert.rejects(runRetention(executor, { dryRun: false, batchSize: 0 }));
  await assert.rejects(runRetention(executor, { dryRun: false, batchSize: 1.5 }));
  await assert.rejects(runRetention(executor, { dryRun: false, batchSize: 100_000 }));
  await assert.rejects(runRetention(executor, { dryRun: false, maxBatchesPerTarget: 0 }));
  await assert.rejects(runRetention(executor, { dryRun: false, now: new Date('nope') }));
  assert.equal(calls.length, 0);
  assert.equal(DEFAULT_BATCH_SIZE > 0, true);
});

test('permissions template: the cleanup role gets SELECT and DELETE on exactly the three tables and the runtime grants stay delete-free', () => {
  const role = readFileSync(
    new URL('../../../docs/production/deploy-kit/retention_cleanup_role.sql', import.meta.url),
    'utf8',
  );
  const code = role
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  assert.match(
    code,
    /CREATE ROLE nook_cleanup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/,
  );
  const grants = [...code.matchAll(/GRANT ([A-Z, ]+) ON TABLE ([^;]+) TO nook_cleanup;/g)];
  assert.equal(grants.length, 1);
  assert.equal(grants[0]![1], 'SELECT, DELETE');
  assert.deepEqual(
    grants[0]![2]!
      .split(',')
      .map((s) => s.trim().replace('public.', ''))
      .sort(),
    ['resident_auth_throttles', 'resident_otp_challenges', 'resident_sessions'],
  );
  assert.doesNotMatch(
    code,
    /audit_events|SUPERUSER PASSWORD|DELETE ON ALL|ALL TABLES|ALL PRIVILEGES/,
  );
  const grantsSql = readFileSync(
    new URL('../../../docs/production/deploy-kit/grants.sql', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(grantsSql.replace(/--[^\n]*/g, ''), /GRANT[^;]*DELETE[^;]*TO nook_app/);
});
