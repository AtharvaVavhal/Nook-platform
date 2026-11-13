import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';

// Exercises the installed migration engine, not a manual transaction or a hypothetical down migration.
test('installed Prisma engine failure is detected and blocks redeploy; record partial-DDL recovery requirements', async () => {
  const root = process.cwd(),
    dir = mkdtempSync(join(tmpdir(), 'nook-migration-failure-'));
  const migration = '29990101000000_phase4_test_failure';
  try {
    const migrations = join(dir, 'migrations');
    cpSync(resolve(root, 'prisma/migrations'), migrations, { recursive: true });
    mkdirSync(join(migrations, migration));
    writeFileSync(
      join(migrations, migration, 'migration.sql'),
      'CREATE TABLE phase4_test_failure_probe(id integer PRIMARY KEY);\nSELECT 1/0;\n',
    );
    const config = join(dir, 'prisma.config.mjs');
    writeFileSync(
      config,
      `import { defineConfig } from ${JSON.stringify(resolve(root, 'node_modules/prisma/config.js'))};\nexport default defineConfig({schema:${JSON.stringify(resolve(root, 'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.MIGRATOR_DATABASE_URL}});\n`,
    );
    const deploy = () =>
      spawnSync(
        process.execPath,
        ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', config],
        {
          cwd: root,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            DOTENV_CONFIG_PATH: '/dev/null',
            MIGRATOR_DATABASE_URL: process.env.MIGRATOR_DATABASE_URL,
          },
          encoding: 'utf8',
          timeout: 120_000,
        },
      );
    const first = deploy();
    assert.notEqual(first.status, 0);
    assert.match(first.stdout + first.stderr, /P3018/);
    let ddlRemains = false;
    await withMigratorClient(async (db) => {
      ddlRemains = (
        await db.query("SELECT to_regclass('public.phase4_test_failure_probe') IS NOT NULL present")
      ).rows[0].present;
      const row = (
        await db.query(
          'SELECT finished_at,rolled_back_at FROM _prisma_migrations WHERE migration_name=$1',
          [migration],
        )
      ).rows;
      assert.equal(row.length, 1);
      assert.equal(row[0].finished_at, null);
      assert.equal(row[0].rolled_back_at, null);
      const expected = JSON.parse(readFileSync('scripts/ci/g6b-migrations.json', 'utf8')).migrations
        .length;
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL',
          )
        ).rows[0].n,
        expected,
      );
    });
    const retry = deploy();
    assert.notEqual(retry.status, 0);
    assert.match(retry.stdout + retry.stderr, /P3009/);
    console.log(
      JSON.stringify({
        probe: 'migration-engine-failure',
        engine: '7.10.1',
        error: 'P3018',
        retry: 'P3009',
        partialDdlRemains: ddlRemains,
        priorMigrationsPreserved: 24,
        cleanup: 'exact disposable cluster removed by parent; no ledger repair attempted',
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
