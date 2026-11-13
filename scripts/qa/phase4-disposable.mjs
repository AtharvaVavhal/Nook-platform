/** Isolated local PostgreSQL verification. Never reads .env or accepts a database URL. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { deployFoundation } from '../ci/g6a-migration.js';
import { verifyMigrationFiles } from '../ci/g6b-migration.js';
import { readSchema, verifySchemaFacts } from '../ci/g6b-preflight.js';
import { DATABASE_MARKER } from '../../apps/api/test/integration/helpers/guard.ts';

const root = resolve(import.meta.dirname, '../..');
const profile = process.argv[2];
const mode = process.argv[3] ?? 'regression';
assert.ok(['regression', 'browser', 'a6', 'probes', 'performance', 'transfer-verification', 'transfer-readiness', 'transfer-consumers', 'transfer-engine', 'transfer-race', 'permission-layer', 'assignment-finance', 'catalog-capture', 'catalog-verify', 'transfer-browser', 'fresh-compatibility', 'upgrade-compatibility', 'nonfinancial-regression', 'migration-failure'].includes(mode));
assert.ok(mode === 'regression' || profile === 'diagnostic' || (profile === 'full' && ['a6', 'probes', 'performance', 'transfer-verification', 'transfer-readiness', 'transfer-consumers', 'transfer-engine', 'transfer-race', 'permission-layer', 'assignment-finance', 'catalog-capture', 'catalog-verify', 'transfer-browser', 'fresh-compatibility', 'upgrade-compatibility', 'nonfinancial-regression', 'migration-failure'].includes(mode)));
assert.ok(['initial-migration', 'full', 'diagnostic', 'full-migration-browser'].includes(profile), 'Select initial-migration, full, diagnostic or full-migration-browser');
if (['fresh-compatibility', 'upgrade-compatibility', 'nonfinancial-regression', 'migration-failure'].includes(mode)) {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
}
if (mode === 'transfer-browser') {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
  assert.ok(process.env.NOOK_BROWSER_EXECUTABLE, 'NOOK_BROWSER_EXECUTABLE required');
}
if (mode === 'catalog-verify') {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
}
if (mode === 'catalog-capture') {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
}
if (mode === 'assignment-finance') {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
}
if (mode === 'permission-layer') {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
}
if (mode === 'transfer-race') {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
}
if (mode === 'transfer-engine') {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
}
if (mode === 'transfer-consumers') {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
}
if (mode === 'transfer-readiness') {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
}
if (mode === 'transfer-verification') {
  assert.equal(profile, 'full');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
}
if (profile === 'full-migration-browser') {
  assert.equal(mode, 'regression');
  assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1', 'Disposable authorization required');
  assert.ok(process.env.NOOK_BROWSER_EXECUTABLE, 'NOOK_BROWSER_EXECUTABLE required');
}
// Verify the complete chain BEFORE provisioning; never ignore missing files or change recorded checksums.
if (profile === 'full' || profile === 'full-migration-browser')
  verifyMigrationFiles(
    resolve(root, 'prisma/migrations'),
    JSON.parse(readFileSync(resolve(root, 'scripts/ci/g6b-migrations.json'))),
  );
if (profile === 'diagnostic') {
  const manifest = JSON.parse(readFileSync(resolve(root, 'scripts/ci/g6b-migrations.json')));
  const original = manifest.migrations.at(-1);
  assert.equal(original.name, '20261108120000_p4_2_corrections');
  const directory = resolve(root, 'prisma/migrations');
  assert.deepEqual(readdirSync(directory).sort(), [...manifest.migrations.slice(0, -1).map((m) => m.name), 'migration_lock.toml'].sort());
  for (const m of manifest.migrations.slice(0, -1)) {
    const file = resolve(directory, m.name, 'migration.sql');
    assert.equal(lstatSync(file).isSymbolicLink(), false);
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), m.checksum);
  }
  const provenance = JSON.parse(readFileSync(resolve(root, 'docs/phase-4/recovery/provenance.json')));
  assert.equal(provenance.originalRecordedSha256, original.checksum);
  assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'docs/phase-4/recovery/corrections-diagnostic.sql'))).digest('hex'), provenance.candidateSha256);
  console.log('DIAGNOSTIC SCHEMA: original corrections migration still missing; results do not certify migration history.');
}
const runId = randomUUID();
const name = `nook-phase4-${runId}`;
const password = () => randomBytes(32).toString('hex');
const bootstrapPassword = password();
const migratorPassword = password();
const runtimePassword = password();
const database = `nook_integration_${runId.replaceAll('-', '')}`;
const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, DOTENV_CONFIG_PATH: '/dev/null' };
const docker = (args, env = baseEnv) => {
  const r = spawnSync('docker', args, { env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `Docker ${args[0]} failed`); // never print arbitrary engine output
  return r.stdout.trim();
};
const clients = [];
let created = false;
async function connect(options) {
  const c = new pg.Client({ ...options, connectionTimeoutMillis: 2000 });
  await c.connect();
  clients.push(c);
  return c;
}
try {
  docker(
    [
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      '--label',
      `nook.phase4.run=${runId}`,
      '--mount',
      'type=tmpfs,destination=/var/lib/postgresql/data',
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_PASSWORD',
      'postgres:17.11-alpine',
    ],
    { ...baseEnv, POSTGRES_PASSWORD: bootstrapPassword },
  );
  created = true;
  const info = JSON.parse(docker(['inspect', '--format', '{{json .}}', name]));
  assert.equal(info.Config.Labels['nook.phase4.run'], runId);
  assert.equal(info.Mounts.length, 1);
  assert.equal(info.Mounts[0].Type, 'tmpfs');
  const binding = info.NetworkSettings.Ports['5432/tcp'][0];
  assert.equal(binding.HostIp, '127.0.0.1');
  const port = Number(binding.HostPort);
  assert.ok(port > 1024 && ![5432, 5433].includes(port));
  const endpoint = { host: '127.0.0.1', port, ssl: false };
  let admin;
  for (let i = 0; i < 60; i++) {
    try {
      admin = await connect({
        ...endpoint,
        database: 'postgres',
        user: 'postgres',
        password: bootstrapPassword,
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert.ok(admin, 'Disposable server did not start');
  assert.deepEqual(
    (await admin.query('SELECT datname FROM pg_database ORDER BY datname')).rows.map(
      (r) => r.datname,
    ),
    ['postgres', 'template0', 'template1'],
  );
  console.log(
    JSON.stringify({ runId, host: endpoint.host, port, storage: 'tmpfs', freshCluster: true }),
  );
  for (const [role, secret] of [
    ['nook_ci_full_migrator', migratorPassword],
    ['nook_ci_full_runtime', runtimePassword],
  ]) {
    await admin.query(
      `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${secret}'`,
    );
  }
  for (const db of ['postgres', 'template0', 'template1'])
    await admin.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
  await admin.query(`CREATE DATABASE ${database} OWNER nook_ci_full_migrator`);
  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO nook_ci_full_runtime`);
  await admin.query(`COMMENT ON DATABASE ${database} IS '${DATABASE_MARKER}'`);
  const owner = await connect({
    ...endpoint,
    database,
    user: 'nook_ci_full_migrator',
    password: migratorPassword,
  });
  if (mode === 'performance') {
    const observer = await connect({ ...endpoint, database, user: 'postgres', password: bootstrapPassword });
    await observer.query(`CREATE FUNCTION public.nook_a3_observe_activity(target_pids integer[])
      RETURNS TABLE(sampled_at timestamptz, pid integer, state text, wait_event_type text, wait_event text,
                    transaction_age_ms numeric, query_age_ms numeric)
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
        SELECT clock_timestamp(), a.pid, a.state, a.wait_event_type, a.wait_event,
               extract(epoch FROM (clock_timestamp()-a.xact_start))*1000,
               extract(epoch FROM (clock_timestamp()-a.query_start))*1000
          FROM pg_stat_activity a WHERE a.pid=ANY(target_pids)
      $$`);
    await observer.query('REVOKE ALL ON FUNCTION public.nook_a3_observe_activity(integer[]) FROM PUBLIC');
    await observer.query('GRANT EXECUTE ON FUNCTION public.nook_a3_observe_activity(integer[]) TO nook_ci_full_migrator');
    await observer.end();
  }
  await owner.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await owner.query('GRANT USAGE ON SCHEMA public TO nook_ci_full_runtime');
  const url = (role, secret) => `postgresql://${role}:${secret}@127.0.0.1:${port}/${database}`;
  const migratorUrl = url('nook_ci_full_migrator', migratorPassword);
  const env = {
    ...baseEnv,
    APP_ENV: 'test',
    TSX_TSCONFIG_PATH: resolve(root, 'apps/api/tsconfig.json'),
    DATABASE_URL: url('nook_ci_full_runtime', runtimePassword),
    MIGRATOR_DATABASE_URL: migratorUrl,
    NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB: '1',
    NOOK_DATABASE_TESTS_REQUIRED: '1',
    NOOK_INTEGRATION_PROFILE: ['diagnostic', 'full-migration-browser'].includes(profile) ? 'full' : profile,
    TEST_OWNER_PASSWORD: password(),
    ...(mode === 'performance' ? { NOOK_PERFORMANCE_EVIDENCE: '1' } : {}),
    ...(mode === 'transfer-race' ? { RACE_INTERLEAVINGS: process.env.RACE_INTERLEAVINGS ?? '1000', RACE_SEED: '20261113' } : {}),
    ...(mode === 'a6' ? { A6_INTERLEAVINGS: '1000', A6_PARALLEL: '4', A6_SEED: '20261109' } : {}),
  };
  if (mode === 'upgrade-compatibility') {
    const { prepareUpgrade } = await import('./phase4-upgrade.mjs');
    env.NOOK_UPGRADE_SNAPSHOT = JSON.stringify(await prepareUpgrade(owner, root, baseEnv, migratorUrl));
  }
  if (profile === 'initial-migration') await deployFoundation(owner, migratorUrl);
  else {
    const r = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        cwd: root,
        env: { ...baseEnv, DATABASE_URL: migratorUrl },
        encoding: 'utf8',
        timeout: 120_000,
      },
    );
    if (r.status !== 0) {
      const diagnostic = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
        .replaceAll(migratorUrl, '[redacted database URL]')
        .replaceAll(migratorPassword, '[redacted]')
        .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted database URL]');
      console.error('Migration diagnostic:', diagnostic.slice(0, 6000));
    }
    assert.equal(
      r.status,
      0,
      'Full Prisma migration failed (output withheld to protect credentials)',
    );
  }
  if (profile === 'diagnostic') {
    await owner.query(readFileSync(resolve(root, 'docs/phase-4/recovery/corrections-diagnostic.sql'), 'utf8'));
    verifySchemaFacts(await readSchema(owner));
    console.log('Diagnostic catalog matches the existing expected schema; original migration provenance is still unresolved.');
  }
  for (const { tablename } of (
    await owner.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
    )
  ).rows) {
    assert.match(tablename, /^[a-z_]+$/);
    const appendOnly = [
      'audit_events',
      'invoice_voids',
      'correction_command_receipts',
      'transfers',
      'transfer_command_receipts',
      'stay_assignment_replacements',
      'transfer_finance_reviews',
      'transfer_finance_resolutions',
      'correction_finance_links',
    ].includes(tablename);
    await owner.query(
      `GRANT SELECT, INSERT${appendOnly ? '' : ', UPDATE'} ON ${tablename} TO nook_ci_full_runtime`,
    );
  }
  if (profile !== 'initial-migration') await owner.query('GRANT SELECT ON effective_stay_assignments TO nook_ci_full_runtime');
  await owner.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nook_ci_full_runtime');
  if (profile !== 'initial-migration' && mode !== 'upgrade-compatibility') {
    if (profile === 'full-migration-browser') {
      const generated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'generate'], {
        cwd: root, env: { ...baseEnv, DATABASE_URL: migratorUrl }, encoding: 'utf8', timeout: 120_000,
      });
      assert.equal(generated.status, 0, 'Prisma generation failed (output withheld)');
    }
    const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/ci/seed-fixtures.js'], { cwd: root, env, stdio: 'inherit', timeout: 60_000 });
    assert.equal(seeded.status, 0, 'Verified integration fixtures failed');
  }
  const args =
    profile === 'initial-migration'
      ? ['--import', 'tsx', '--test', 'apps/api/test/integration/database-migration.test.ts']
      : [
          '--import',
          'tsx',
          '--test',
          '--test-concurrency=1',
          ...JSON.parse(readFileSync(resolve(root, 'scripts/ci/test-files.json'))).full.filter(n => mode !== 'nonfinancial-regression' || !['corrections', 'finance', 'invoice-scheduler'].includes(n)).map(
            (n) => `apps/api/test/integration/${n}.integration.test.ts`,
          ),
        ];
  const selected = mode === 'migration-failure' ? ['--import', 'tsx', '--test', 'scripts/qa/phase4-migration-failure.test.ts'] : ['fresh-compatibility', 'upgrade-compatibility'].includes(mode) ? ['--import', 'tsx', '--test', 'scripts/qa/phase4-compatibility.test.ts'] : mode === 'catalog-verify' ? ['--import', 'tsx', '--test', 'scripts/qa/phase4-catalog-verify.test.ts'] : mode === 'catalog-capture' ? ['--import', 'tsx', '--test', 'scripts/qa/phase4-catalog-capture.test.ts'] : mode === 'assignment-finance' ? ['--import', 'tsx', '--test', 'scripts/qa/assignment-finance.test.ts'] : mode === 'permission-layer' ? ['--import', 'tsx', '--test', 'scripts/qa/permission-layer.test.ts'] : mode === 'transfer-race' ? ['--import', 'tsx', '--test', 'scripts/qa/transfer-race.test.ts'] : mode === 'transfer-engine' ? ['--import', 'tsx', '--test', 'scripts/qa/transfer-engine.test.ts'] : mode === 'transfer-consumers' ? ['--import', 'tsx', '--test', 'scripts/qa/transfer-consumers.test.ts'] : mode === 'transfer-readiness' ? ['--import', 'tsx', '--test', 'scripts/qa/transfer-readiness.test.ts'] : mode === 'transfer-verification' ? ['--import', 'tsx', '--test', 'scripts/qa/transfer-verification.test.ts'] : mode === 'performance' ? ['--import', 'tsx', '--test', '--test-name-pattern=^performance evidence', 'apps/api/test/integration/corrections.integration.test.ts'] : mode === 'probes' ? ['--import', 'tsx', '--test', 'scripts/qa/gate-locks.test.ts'] : mode === 'a6' ? ['--import', 'tsx', '--test', '--test-name-pattern=^A6 scenario', 'apps/api/test/integration/corrections.integration.test.ts'] : args;
  const result = mode === 'transfer-browser' || mode === 'browser' || profile === 'full-migration-browser' ? { status: 0 } : spawnSync(process.execPath, selected, {
    cwd: root,
    env,
    ...(profile === 'full' ? { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 } : { stdio: 'inherit' }),
    timeout: mode === 'a6' || mode === 'transfer-race' ? 7200_000 : 1200_000,
  });
  if (profile === 'full' && mode !== 'transfer-browser') {
    const lines = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split('\n');
    const safe = lines.filter((line) => /^(ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) |✖ |# A6 |﹣ |\{"probe":)/.test(line));
    writeFileSync(resolve(root, 'docs/phase-4/evidence', `integration-${runId}.txt`), `${safe.join('\n')}\nExit: ${result.status ?? 'terminated'}\n`);
    console.log(safe.join('\n'));
  }
  process.exitCode = result.status ?? 1;
  if (mode === 'transfer-browser') {
    const browser = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/e2e/transfers-read.e2e.mjs'], {
      cwd: root, env: { ...env, E2E_RUNTIME_URL: env.DATABASE_URL, E2E_MIGRATOR_URL: migratorUrl,
        NOOK_BROWSER_EXECUTABLE: process.env.NOOK_BROWSER_EXECUTABLE }, encoding: 'utf8', timeout: 300_000,
    });
    const evidence = (browser.stdout ?? '').split('\n').filter(line => line.startsWith('TRANSFER_ACCEPTANCE '));
    writeFileSync(resolve(root, 'docs/phase-4/evidence', `transfer-browser-${runId}.txt`), `${evidence.join('\n')}\nExit: ${browser.status ?? 'terminated'}\n`);
    console.log(evidence.join('\n'));
    if (browser.status !== 0 || evidence.length !== 1) process.exitCode = 1;
  }
  if (((profile === 'diagnostic' && mode !== 'a6') || profile === 'full-migration-browser') && result.status === 0) {
    const browser = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/e2e/corrections.e2e.mjs'], {
      cwd: root, env: { ...env, E2E_RUNTIME_URL: env.DATABASE_URL, E2E_MIGRATOR_URL: migratorUrl,
        NOOK_BROWSER_EXECUTABLE: profile === 'diagnostic' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.env.NOOK_BROWSER_EXECUTABLE,
        ...(profile === 'full-migration-browser' ? { NOOK_E2E_SANITIZED: '1', E2E_ARTIFACTS: `/tmp/nook-e2e-${runId}` } : {}) },
      ...(profile === 'diagnostic' ? { stdio: 'inherit' } : { encoding: 'utf8' }), timeout: 300_000,
    });
    if (profile === 'full-migration-browser') {
      const summary = (browser.stdout ?? '').split('\n').filter((line) => /^(PASS\s{2}E\d+\s|FAIL\s{2}E\d+\s|E2E scenarios:\s|API 5xx\/ERROR log markers:\s|E6 API 5xx\s[5-9]\d\d\s\/api\/v1\/[a-zA-Z0-9_/-]+$)/.test(line)).join('\n');
      const safeSummary = summary.split('\n').map((line) => line.replace(/^(PASS|FAIL)\s{2}(E\d+).*/, '$1 $2')).join('\n');
      writeFileSync(resolve(root, 'docs/phase-4/evidence', `browser-${runId}.txt`), `${safeSummary}\nExit: ${browser.status ?? 'terminated'}\n`);
      console.log(`Browser acceptance exit status: ${browser.status ?? 'terminated'} (details withheld)`);
    }
    if (browser.status !== 0) process.exitCode = 1;
  }
  if (profile === 'initial-migration') {
    const locks = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--test', 'scripts/qa/gate-locks.test.ts'],
      { cwd: root, env, stdio: 'inherit', timeout: 120_000 },
    );
    if (locks.status !== 0) process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({probe:'harness-failure',code:/^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : null,constraint:/^[a-z_]+$/.test(error?.constraint ?? '') ? error.constraint : null,table:/^[a-z_]+$/.test(error?.table ?? '') ? error.table : null}));
  console.error(
    `Disposable verification failed: ${error instanceof assert.AssertionError ? error.message : 'provisioning or test error; sensitive driver output withheld'}`,
  );
  process.exitCode = 1;
} finally {
  for (const c of clients.reverse()) await c.end().catch(() => {});
  if (created) {
    const label = docker([
      'inspect',
      '--format',
      '{{index .Config.Labels "nook.phase4.run"}}',
      name,
    ]);
    assert.equal(label, runId, 'Refusing cleanup of a resource not created by this run');
    docker(['stop', '--time', '5', name]);
    const remaining = docker([
      'ps',
      '-a',
      '--filter',
      `label=nook.phase4.run=${runId}`,
      '--format',
      '{{.ID}}',
    ]);
    assert.equal(remaining, '', 'Disposable container cleanup incomplete');
    console.log(
      `CLEANUP VERIFIED ${runId}: exact container removed; tmpfs discarded; no volumes created or deleted.`,
    );
  }
}
