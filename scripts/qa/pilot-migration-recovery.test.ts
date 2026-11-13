import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';

// Forward-repair rehearsal on a DISPOSABLE database with SYNTHETIC migrations only. It extends the existing
// phase4-migration-failure.test.ts (which proves failure detection and the P3009 block) with the repair path:
// reviewed manual cleanup of the partial DDL, `prisma migrate resolve --rolled-back`, and a corrected redeploy.
// It does NOT rehearse restore-from-backup (that needs the backup tooling) and approves no production procedure.
test('forward repair after a failed migration: cleanup, resolve --rolled-back, corrected redeploy', async () => {
  const root = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'nook-migration-recovery-'));
  const migration = '29990101000000_pilot_recovery_probe';
  try {
    const migrations = join(dir, 'migrations');
    cpSync(resolve(root, 'prisma/migrations'), migrations, { recursive: true });
    mkdirSync(join(migrations, migration));
    const migrationFile = join(migrations, migration, 'migration.sql');
    writeFileSync(
      migrationFile,
      'CREATE TABLE pilot_recovery_probe(id integer PRIMARY KEY);\nSELECT 1/0;\n',
    );
    const config = join(dir, 'prisma.config.mjs');
    writeFileSync(
      config,
      `import { defineConfig } from ${JSON.stringify(resolve(root, 'node_modules/prisma/config.js'))};\nexport default defineConfig({schema:${JSON.stringify(resolve(root, 'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.MIGRATOR_DATABASE_URL}});\n`,
    );
    const prisma = (...args: string[]) =>
      spawnSync(
        process.execPath,
        ['node_modules/prisma/build/index.js', ...args, '--config', config],
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
    const out = (r: ReturnType<typeof prisma>) => `${r.stdout}${r.stderr}`;
    const expected = JSON.parse(readFileSync('scripts/ci/g6b-migrations.json', 'utf8')).migrations
      .length as number;
    const ledger = () =>
      withMigratorClient(async (db) => ({
        finished: (
          await db.query(
            'SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
          )
        ).rows as { migration_name: string; checksum: string }[],
        probe: (
          await db.query("SELECT to_regclass('public.pilot_recovery_probe') IS NOT NULL present")
        ).rows[0].present as boolean,
      }));

    const before = await ledger();
    assert.equal(before.finished.length, expected);

    // 1. the failure
    const first = prisma('migrate', 'deploy');
    assert.notEqual(first.status, 0);
    assert.match(out(first), /P3018/);
    const afterFailure = await ledger();
    const partialDdl = afterFailure.probe;
    assert.equal(
      partialDdl,
      true,
      'this engine leaves the earlier statements of a failed migration applied',
    );

    // 2. the block: a blind redeploy is refused
    const retry = prisma('migrate', 'deploy');
    assert.notEqual(retry.status, 0);
    assert.match(out(retry), /P3009/);

    // 3. status reports the failed migration by name
    const status = prisma('migrate', 'status');
    assert.notEqual(status.status, 0);
    assert.ok(out(status).includes(migration), 'status names the failed migration');

    // 4. forward repair: (a) reviewed cleanup of the partial DDL, (b) resolve as rolled back, (c) corrected file, (d) redeploy
    await withMigratorClient(async (db) => {
      await db.query('DROP TABLE public.pilot_recovery_probe');
    });
    const resolved = prisma('migrate', 'resolve', '--rolled-back', migration);
    assert.equal(resolved.status, 0, 'resolve --rolled-back');
    writeFileSync(migrationFile, 'CREATE TABLE pilot_recovery_probe(id integer PRIMARY KEY);\n');
    const redeploy = prisma('migrate', 'deploy');
    assert.equal(redeploy.status, 0, 'corrected redeploy');

    // 5. the outcome
    const after = await ledger();
    assert.equal(after.probe, true);
    assert.equal(after.finished.length, expected + 1);
    const original = new Map(before.finished.map((r) => [r.migration_name, r.checksum]));
    for (const [name, checksum] of original) {
      const now = after.finished.find((r) => r.migration_name === name);
      assert.equal(now?.checksum, checksum, `original migration ${name} unchanged`);
    }
    const finalStatus = prisma('migrate', 'status');
    assert.equal(finalStatus.status, 0);
    console.log(
      JSON.stringify({
        evidence: 'migration-forward-repair-rehearsal',
        engine: '7.10.1',
        failure: 'P3018',
        partialDdlRemainedAfterFailure: partialDdl,
        blindRetry: 'P3009',
        repair: 'manual cleanup + migrate resolve --rolled-back + corrected redeploy',
        originalMigrationsUnchanged: original.size,
        finishedAfterRepair: after.finished.length,
        statusAfterRepair: 'up to date',
        notRehearsed: 'restore from backup',
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
