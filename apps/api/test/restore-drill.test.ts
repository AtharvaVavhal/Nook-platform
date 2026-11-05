import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// The restore-drill script's safety rules, exercised without any database: every case below must be refused (or
// printed) before any PostgreSQL tool runs. The tools on PATH are shims that fail loudly if they are ever invoked.
const SCRIPT = new URL('../../../scripts/ops/restore-drill.sh', import.meta.url).pathname;
const SECRET = 'S3cr3t-Pa55word-that-must-never-appear';

const work = mkdtempSync(join(tmpdir(), 'drill-test-'));
const bin = join(work, 'bin');
mkdirSync(bin);
for (const tool of ['pg_dump', 'pg_restore', 'psql', 'docker']) {
  writeFileSync(join(bin, tool), '#!/bin/sh\necho "TOOL INVOKED: $0" >&2\nexit 99\n');
  chmodSync(join(bin, tool), 0o755);
}
const goodPass = join(work, 'pass-ok');
writeFileSync(goodPass, 'a-long-passphrase-for-testing-only-1234');
chmodSync(goodPass, 0o600);
const loosePass = join(work, 'pass-loose');
writeFileSync(loosePass, 'a-long-passphrase-for-testing-only-1234');
chmodSync(loosePass, 0o644);
const shortPass = join(work, 'pass-short');
writeFileSync(shortPass, 'short');
chmodSync(shortPass, 0o600);

const env = {
  PATH: `${bin}:/usr/bin:/bin`,
  HOME: work,
  SOURCE_DATABASE_URL: `postgresql://src_user:${SECRET}@source.internal:5433/nook_source`,
  DRILL_ADMIN_URL: `postgresql://admin_user:${SECRET}@drill.internal:5432/postgres`,
};
let counter = 0;
const out = () => join(work, `out-${(counter += 1)}`);

function drill(args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    timeout: 20_000,
  });
  const output = `${r.stdout}${r.stderr}`;
  assert.ok(!output.includes(SECRET), 'a password must never be printed');
  assert.ok(!output.includes('TOOL INVOKED'), `a PostgreSQL tool ran: ${output}`);
  return { code: r.status, output };
}

const good = (over: string[] = []) => [
  '--confirm-source',
  'source.internal:5433/nook_source',
  '--target-db',
  'nook_restore_drill_a',
  '--confirm-target',
  'drill.internal:5432/nook_restore_drill_a',
  '--out-dir',
  out(),
  '--passphrase-file',
  goodPass,
  '--yes-create-database',
  ...over,
];

const refused = (args: string[], pattern: RegExp, extraEnv: Record<string, string> = {}) => {
  const r = drill(args, extraEnv);
  assert.equal(r.code, 2, `expected a refusal, got ${r.code}: ${r.output}`);
  assert.match(r.output, pattern);
};

test('no command, or an unknown one, prints usage and exits 2', () => {
  assert.equal(drill([]).code, 2);
  assert.equal(drill(['explode']).code, 2);
  refused(['run', '--no-such-flag'], /usage/);
});

test('plan prints the plan, contacts nothing and never shows a password', () => {
  const r = drill(['plan', ...good()]);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /nothing has been contacted/);
  assert.match(r.output, /source\s+: source\.internal:5433\/nook_source/);
  assert.match(r.output, /drill\.internal:5432\/nook_restore_drill_a/);
  assert.match(r.output, /never an existing database/);
  assert.match(r.output, /no unencrypted dump on disk/);
});

test('the target must be a new database named nook_restore_drill_*, never a protected or injected name', () => {
  for (const name of [
    'nook_dev',
    'nook_test',
    'postgres',
    'template1',
    'nook_4f1_scratch',
    'production',
    'nook_restore_drill_',
    'Nook_Restore_Drill_a',
    'nook_restore_drill_a-b',
    'nook_restore_drill_x"; DROP DATABASE nook_dev; --',
    `nook_restore_drill_${'x'.repeat(41)}`,
  ]) {
    refused(
      ['run', ...good(), '--target-db', name, '--confirm-target', `drill.internal:5432/${name}`],
      /--target-db must match|can never be/,
    );
  }
});

test('run needs the confirmations: source, target, and explicit approval to create a database', () => {
  refused(
    ['run', ...good(), '--confirm-source', 'source.internal:5433/other'],
    /--confirm-source must be exactly the source/,
  );
  refused(
    ['run', ...good(), '--confirm-target', 'drill.internal:5432/nook_restore_drill_b'],
    /--confirm-target must be exactly the drill database/,
  );
  refused(['run', ...good().filter((a) => a !== '--yes-create-database')], /--yes-create-database/);
  refused(['run', ...good(), '--source-kind', 'whatever'], /--source-kind/);
});

test('the passphrase file must exist, be mode 600 and be long enough', () => {
  refused(['run', ...good(), '--passphrase-file', join(work, 'missing')], /does not exist/);
  refused(['run', ...good(), '--passphrase-file', loosePass], /mode 600/);
  refused(['run', ...good(), '--passphrase-file', shortPass], /at least 24 characters/);
  const noFlag = good();
  noFlag.splice(noFlag.indexOf('--passphrase-file'), 2);
  refused(['run', ...noFlag], /--passphrase-file is required/);
});

test('an existing output directory is never reused or overwritten', () => {
  const existing = join(work, 'already-there');
  mkdirSync(existing);
  writeFileSync(join(existing, 'precious.txt'), 'keep me');
  refused(['run', ...good(), '--out-dir', existing], /already exists/);
  assert.equal(readFileSync(join(existing, 'precious.txt'), 'utf8'), 'keep me');
});

test('the source and the drill database can never be the same database', () => {
  refused(
    ['run', ...good(), '--confirm-source', 'drill.internal:5432/nook_restore_drill_a'],
    /same database/,
    {
      SOURCE_DATABASE_URL: `postgresql://u:${SECRET}@drill.internal:5432/nook_restore_drill_a`,
    },
  );
});

test('connection URLs must be present and be postgres URLs', () => {
  refused(['run', ...good()], /is empty or not set/, { SOURCE_DATABASE_URL: '' });
  refused(['run', ...good()], /not a valid postgres/, {
    SOURCE_DATABASE_URL: 'https://example.test/x',
  });
  refused(['run', ...good()], /is empty or not set/, { DRILL_ADMIN_URL: '' });
  refused(['run', ...good(), '--source-env', 'NOT_SET_ANYWHERE'], /NOT_SET_ANYWHERE/);
});

test('the tool runner must be local or docker-exec', () => {
  refused(['run', ...good(), '--runner', 'ssh:somewhere'], /--runner must be/);
});

test('cleanup only acts on an exactly named, confirmed drill database', () => {
  refused(
    [
      'cleanup',
      '--target-db',
      'nook_dev',
      '--confirm-target',
      'drill.internal:5432/nook_dev',
      '--out-dir',
      out(),
    ],
    /--target-db must match|can never be/,
  );
  refused(
    [
      'cleanup',
      '--target-db',
      'nook_restore_drill_a',
      '--confirm-target',
      'drill.internal:5432/nook_restore_drill_z',
      '--out-dir',
      out(),
    ],
    /--confirm-target must be exactly/,
  );
});

test('fingerprint needs the source confirmed and writes only into a new directory', () => {
  refused(
    ['fingerprint', '--confirm-source', 'wrong:1/x', '--out-dir', out()],
    /--confirm-source must be exactly/,
  );
  const existing = join(work, 'fp-exists');
  mkdirSync(existing);
  refused(
    ['fingerprint', '--confirm-source', 'source.internal:5433/nook_source', '--out-dir', existing],
    /already exists/,
  );
});

test('the script and its SQL stay read-only on the source: no write statements in the verification SQL', () => {
  const sql = readFileSync(
    new URL('../../../scripts/ops/restore-verify.sql', import.meta.url),
    'utf8',
  )
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''"); // privilege names and labels are string literals, not statements
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i);
  assert.ok(existsSync(SCRIPT));
  const script = readFileSync(SCRIPT, 'utf8');
  assert.match(script, /default_transaction_read_only=on/);
  assert.doesNotMatch(script, /PGPASSWORD=\S+\s+(docker|pg_)/, 'no password on a command line');
});
