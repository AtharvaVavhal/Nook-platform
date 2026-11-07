import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { INITIAL_MIGRATION_TABLES } from '../../apps/api/test/integration/helpers/guard.ts';

export const FOUNDATION = '20261031154500_slice_2_2_foundation';
const root = fileURLToPath(new URL('../../', import.meta.url));

export function assertG6AAuthorization(env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    env.GITHUB_JOB !== 'initial-integration' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    !env.GITHUB_WORKFLOW_REF?.includes('/.github/workflows/g6a.yml@') ||
    env.NOOK_CI_G6A_AUTHORIZATION !== 'AUTHORIZE_G6A'
  ) {
    throw new Error('G6A requires the authorized dedicated hosted workflow');
  }
}

export function verifyLedger(rows, checksum) {
  assert.equal(rows.length, 1, 'Expected exactly one Prisma migration ledger record');
  const row = rows[0];
  assert.equal(row.migration_name, FOUNDATION);
  assert.equal(row.checksum, checksum);
  assert.ok(row.started_at && row.finished_at, 'Migration must have started and finished');
  assert.ok(new Date(row.finished_at).getTime() >= new Date(row.started_at).getTime());
  assert.equal(row.rolled_back_at, null);
  assert.ok(Number.isInteger(row.applied_steps_count) && row.applied_steps_count > 0);
  assert.ok(
    row.logs === null || row.logs === '',
    'Successful fresh migration must have no error log',
  );
}

export function verifyTables(rows) {
  assert.deepEqual(rows.map((row) => row.tablename).sort(), [...INITIAL_MIGRATION_TABLES].sort());
}

// Dependency injection is for offline tests only. Production always uses the locked local CLI.
export async function deployFoundation(
  owner,
  migratorUrl,
  { run = spawnSync, report = console.log } = {},
) {
  const installed = JSON.parse(
    readFileSync(resolve(root, 'node_modules/prisma/package.json'), 'utf8'),
  );
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  assert.equal(installed.version, lock.packages['node_modules/prisma'].version);
  assert.equal(installed.version, lock.packages[''].devDependencies.prisma);
  const directory = mkdtempSync(join(tmpdir(), 'nook-g6a-migrations-'));
  try {
    mkdirSync(join(directory, FOUNDATION));
    const source = resolve(root, 'prisma/migrations', FOUNDATION, 'migration.sql');
    copyFileSync(source, join(directory, FOUNDATION, 'migration.sql'));
    copyFileSync(
      resolve(root, 'prisma/migrations/migration_lock.toml'),
      join(directory, 'migration_lock.toml'),
    );
    const checksum = createHash('sha256').update(readFileSync(source)).digest('hex');
    const before = await owner.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    assert.equal(
      before.rows.length,
      0,
      'G6A requires an empty application schema and no prior ledger',
    );
    const result = run(
      process.execPath,
      [
        resolve(root, 'node_modules/prisma', installed.bin.prisma),
        'migrate',
        'deploy',
        '--config',
        resolve(root, 'scripts/ci/g6a-prisma.config.ts'),
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: migratorUrl,
          NOOK_CI_G6A_MIGRATIONS_DIR: directory,
        },
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    // Do not relay arbitrary engine output: it may include database URLs or credentials.
    if (result.error || result.signal || result.status !== 0) {
      throw new Error('Prisma migrate deploy failed; database verification stopped');
    }
    report('G6A: locked Prisma migrate deploy exited successfully.');
    const ledger = await owner.query(`SELECT migration_name, checksum, started_at, finished_at,
      rolled_back_at, applied_steps_count, logs FROM public._prisma_migrations`);
    verifyLedger(ledger.rows, checksum);
    const tables = await owner.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    verifyTables(tables.rows);
    report(
      `G6A: ledger verified for ${FOUNDATION}; checksum ${checksum}; completed, not rolled back.`,
    );
    report(
      `G6A: exactly nine application tables: ${tables.rows
        .map((row) => row.tablename)
        .sort()
        .join(', ')}.`,
    );
  } finally {
    // Only the private directory created by this invocation; it contains SQL, never credentials.
    rmSync(directory, { recursive: true, force: true });
  }
}
