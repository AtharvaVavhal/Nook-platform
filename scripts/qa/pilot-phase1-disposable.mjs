/**
 * Pilot engineering rehearsals on a DISPOSABLE, local, synthetic-data PostgreSQL. NEVER touches a real database.
 * Provisioning mirrors scripts/qa/phase4-disposable.mjs (fresh tmpfs PostgreSQL container bound to 127.0.0.1, labeled,
 * removed at the end; migrator/runtime roles; the CI grants), so results are comparable with the CI harness.
 *
 *   NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1 node --import tsx scripts/qa/pilot-phase1-disposable.mjs <mode>
 *
 * Modes
 *   migration-recovery  failed migration (P3018, then P3009) and forward repair; RUNS IN HOSTED CI (job pilot-rehearsals)
 *   hostel-scale        the 100-bed concurrency test on its own; in hosted CI the same file runs in the `full` profile
 *   roles-grants        roles-and-grants DRAFT checked by docs/release/restore-acl-verification.sql; LOCAL ONLY because
 *                       that verifier is not in the repository (it exits with a clear message when the file is absent)
 *
 * NOOK_DISPOSABLE_PG_IMAGE overrides the container image (default postgres:17.11-alpine). Hosted CI sets it to the
 * digest-pinned image used by the full-integration service, so both jobs test the same PostgreSQL build.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { DATABASE_MARKER } from '../../apps/api/test/integration/helpers/guard.ts';

const root = resolve(import.meta.dirname, '../..');
const mode = process.argv[2];
assert.ok(['hostel-scale', 'migration-recovery', 'roles-grants'].includes(mode), 'unknown mode');
assert.equal(
  process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB,
  '1',
  'Disposable authorization required',
);

const PG_IMAGE = process.env.NOOK_DISPOSABLE_PG_IMAGE ?? 'postgres:17.11-alpine';
// only an official PostgreSQL image, optionally digest-pinned: never an arbitrary image name
assert.match(
  PG_IMAGE,
  /^postgres:\d+\.\d+(-[a-z0-9]+)?(@sha256:[0-9a-f]{64})?$/,
  'unsupported image',
);
const VERIFIER = resolve(root, 'docs/release/restore-acl-verification.sql');
if (mode === 'roles-grants' && !existsSync(VERIFIER)) {
  console.error(
    'roles-grants is local only: docs/release/restore-acl-verification.sql is not in this checkout. Nothing was started.',
  );
  process.exit(2);
}

const APPEND_ONLY = [
  'audit_events',
  'invoice_voids',
  'correction_command_receipts',
  'transfers',
  'transfer_command_receipts',
  'stay_assignment_replacements',
  'transfer_finance_reviews',
  'transfer_finance_resolutions',
  'correction_finance_links',
];
// roles-grants mode uses the DRAFT role names; the other modes use the CI harness names.
const R =
  mode === 'roles-grants'
    ? {
        migrator: 'nook_draft_migrator',
        runtime: 'nook_draft_runtime',
        readonly: 'nook_draft_readonly',
      }
    : { migrator: 'nook_ci_full_migrator', runtime: 'nook_ci_full_runtime', readonly: null };

const runId = randomUUID();
const name = `nook-pilot1-${runId}`;
const secret = () => randomBytes(32).toString('hex');
const bootstrapPassword = secret();
const migratorPassword = secret();
const runtimePassword = secret();
const readonlyPassword = secret();
const database = `nook_integration_${runId.replaceAll('-', '')}`;
const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, DOTENV_CONFIG_PATH: '/dev/null' };
const docker = (args, env = baseEnv, input) => {
  const r = spawnSync('docker', args, { env, encoding: 'utf8', timeout: 120_000, input });
  assert.equal(r.status, 0, `Docker ${args[0]} failed`); // never print arbitrary engine output
  return r.stdout.trim();
};
const clients = [];
async function connect(options) {
  const c = new pg.Client({ ...options, connectionTimeoutMillis: 2000 });
  await c.connect();
  clients.push(c);
  return c;
}
let created = false;

/** DRAFT roles-and-grants procedure (see docs/release/PILOT_ENGINEERING_READINESS_PHASE_1.md). */
async function applyDraftProcedure(admin, owner, port) {
  void port;
  // Step 1 (cluster administrator): roles without privileged attributes. Passwords are set out of band in real use.
  for (const [role, pw] of [
    [R.migrator, migratorPassword],
    [R.runtime, runtimePassword],
    [R.readonly, readonlyPassword],
  ])
    await admin.query(
      `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${pw}'`,
    );
  await admin.query(`CREATE DATABASE ${database} OWNER ${R.migrator}`);
  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${R.runtime}`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${R.readonly}`);
  await admin.query(`COMMENT ON DATABASE ${database} IS '${DATABASE_MARKER}'`);
  await admin.query(`ALTER ROLE ${R.readonly} SET default_transaction_read_only = on`);
  const migrator = await connect({
    host: '127.0.0.1',
    port,
    database,
    user: R.migrator,
    password: migratorPassword,
  });
  // Step 2 (migrator, before migrating): the schema is not open to PUBLIC.
  await migrator.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await migrator.query(`GRANT USAGE ON SCHEMA public TO ${R.runtime}, ${R.readonly}`);
  return migrator;
}

async function grantsAfterMigration(owner) {
  // Step 4 (migrator, after migrating): per-table privileges. Append-only tables get no UPDATE; nothing gets DELETE.
  const tables = (
    await owner.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY 1",
    )
  ).rows;
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const appendOnly = APPEND_ONLY.includes(tablename);
    await owner.query(
      `GRANT SELECT, INSERT${appendOnly ? '' : ', UPDATE'} ON ${tablename} TO ${R.runtime}`,
    );
  }
  await owner.query(`GRANT SELECT ON effective_stay_assignments TO ${R.runtime}`);
  await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${R.runtime}`);
  if (R.readonly) await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${R.readonly}`);
  return tables.length;
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
      `nook.pilot1.run=${runId}`,
      '--mount',
      'type=tmpfs,destination=/var/lib/postgresql/data',
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_PASSWORD',
      PG_IMAGE,
    ],
    { ...baseEnv, POSTGRES_PASSWORD: bootstrapPassword },
  );
  created = true;
  const info = JSON.parse(docker(['inspect', '--format', '{{json .}}', name]));
  assert.equal(info.Config.Labels['nook.pilot1.run'], runId);
  assert.equal(info.Mounts.length, 1);
  assert.equal(info.Mounts[0].Type, 'tmpfs');
  const binding = info.NetworkSettings.Ports['5432/tcp'][0];
  assert.equal(binding.HostIp, '127.0.0.1');
  const port = Number(binding.HostPort);
  assert.ok(port > 1024 && ![5432, 5433, 5545].includes(port));
  let admin;
  for (let i = 0; i < 60; i++) {
    try {
      admin = await connect({
        host: '127.0.0.1',
        port,
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
  console.log(
    JSON.stringify({
      image: PG_IMAGE,
      runId,
      mode,
      host: '127.0.0.1',
      port,
      storage: 'tmpfs',
      freshCluster: true,
    }),
  );
  for (const db of ['postgres', 'template0', 'template1'])
    await admin.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);

  let owner;
  if (mode === 'roles-grants') {
    owner = await applyDraftProcedure(admin, null, port);
  } else {
    for (const [role, pw] of [
      [R.migrator, migratorPassword],
      [R.runtime, runtimePassword],
    ])
      await admin.query(
        `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${pw}'`,
      );
    await admin.query(`CREATE DATABASE ${database} OWNER ${R.migrator}`);
    await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${R.runtime}`);
    await admin.query(`COMMENT ON DATABASE ${database} IS '${DATABASE_MARKER}'`);
    owner = await connect({
      host: '127.0.0.1',
      port,
      database,
      user: R.migrator,
      password: migratorPassword,
    });
    await owner.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${R.runtime}`);
  }
  const url = (role, pw) => `postgresql://${role}:${pw}@127.0.0.1:${port}/${database}`;
  const migratorUrl = url(R.migrator, migratorPassword);
  // Step 3: migrate as the migrator with the repository's installed engine.
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    {
      cwd: root,
      env: { ...baseEnv, DATABASE_URL: migratorUrl },
      encoding: 'utf8',
      timeout: 180_000,
    },
  );
  assert.equal(
    migrated.status,
    0,
    'Prisma migrate deploy failed (output withheld to protect credentials)',
  );
  const tableCount = await grantsAfterMigration(owner);
  console.log(JSON.stringify({ migrated: true, tables: tableCount }));

  const env = {
    ...baseEnv,
    APP_ENV: 'test',
    TSX_TSCONFIG_PATH: resolve(root, 'apps/api/tsconfig.json'),
    DATABASE_URL: url(R.runtime, runtimePassword),
    MIGRATOR_DATABASE_URL: migratorUrl,
    NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB: '1',
    NOOK_DATABASE_TESTS_REQUIRED: '1',
    NOOK_INTEGRATION_PROFILE: 'full',
    TEST_OWNER_PASSWORD: secret(),
  };

  if (mode === 'hostel-scale' || mode === 'migration-recovery') {
    const file =
      mode === 'hostel-scale'
        ? 'apps/api/test/integration/hostel-scale.integration.test.ts'
        : 'scripts/qa/pilot-migration-recovery.test.ts';
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--test', '--test-concurrency=1', file],
      { cwd: root, env, stdio: 'inherit', timeout: 1_200_000 },
    );
    process.exitCode = result.status ?? 1;
  } else {
    // roles-grants: (1) the repository's own ACL verifier against the draft; (2) real statements as each role; (3) deviations.
    const verifier = readFileSync(VERIFIER, 'utf8');
    const psql = (sql, vars = []) =>
      docker(
        [
          'exec',
          '-i',
          name,
          'psql',
          '-U',
          'postgres',
          '-d',
          database,
          '-X',
          '-q',
          '-At',
          '-F|',
          '-v',
          'ON_ERROR_STOP=1',
          ...vars.flatMap((v) => ['-v', v]),
          '-f',
          '-',
        ],
        baseEnv,
        sql,
      );
    const vars = [
      `runtime_role=${R.runtime}`,
      `migrator_role=${R.migrator}`,
      `readonly_role=${R.readonly}`,
    ];
    const verify = () => psql(verifier, vars);
    const baseline = verify();
    console.log(
      JSON.stringify({
        check: 'acl-verifier baseline on draft',
        output: baseline.split('\n').slice(-3),
      }),
    );
    assert.match(baseline, /SUMMARY\|violations\|0\|?\s*$/);

    const behave = async (role, pw, label, statement, expectOk) => {
      const c = new pg.Client({ host: '127.0.0.1', port, database, user: role, password: pw });
      await c.connect();
      let ok = true;
      let code = null;
      try {
        await c.query('BEGIN');
        await c.query(statement);
      } catch (e) {
        ok = false;
        code = e.code;
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        await c.end();
      }
      console.log(JSON.stringify({ check: label, role, succeeded: ok, sqlstate: code }));
      assert.equal(ok, expectOk, label);
      // a refusal must be a PRIVILEGE refusal (42501), or the read-only session refusal (25006) for the read-only role,
      // not an unrelated error such as an unknown column
      if (!expectOk)
        assert.ok(['42501', '25006'].includes(code), `${label}: unexpected SQLSTATE ${code}`);
    };
    await behave(
      R.runtime,
      runtimePassword,
      'runtime can read residents',
      'SELECT count(*) FROM residents',
      true,
    );
    await behave(
      R.runtime,
      runtimePassword,
      'runtime cannot DELETE audit_events',
      'DELETE FROM audit_events',
      false,
    );
    await behave(
      R.runtime,
      runtimePassword,
      'runtime cannot UPDATE audit_events',
      "UPDATE audit_events SET action='x'",
      false,
    );
    await behave(
      R.runtime,
      runtimePassword,
      'runtime cannot UPDATE invoice_voids',
      'UPDATE invoice_voids SET invoice_id = invoice_id',
      false,
    );
    await behave(
      R.runtime,
      runtimePassword,
      'runtime cannot DELETE residents',
      'DELETE FROM residents',
      false,
    );
    await behave(
      R.runtime,
      runtimePassword,
      'runtime cannot create tables',
      'CREATE TABLE public.nope(id int)',
      false,
    );
    await behave(
      R.runtime,
      runtimePassword,
      'runtime cannot read the migration ledger',
      'SELECT 1 FROM _prisma_migrations',
      false,
    );
    await behave(
      R.readonly,
      readonlyPassword,
      'read-only can read residents',
      'SELECT count(*) FROM residents',
      true,
    );
    await behave(
      R.readonly,
      readonlyPassword,
      'read-only cannot INSERT',
      "INSERT INTO organizations (id,name,updated_at) VALUES (gen_random_uuid(),'x',now())",
      false,
    );
    await behave(
      R.readonly,
      readonlyPassword,
      'read-only cannot DELETE',
      'DELETE FROM residents',
      false,
    );

    const deviate = (label, breakSql, restoreSql) => {
      psql(breakSql);
      const out = verify();
      const fails = out.split('\n').filter((l) => l.startsWith('FAIL|'));
      console.log(
        JSON.stringify({ check: `deviation detected: ${label}`, failLines: fails.length }),
      );
      assert.ok(fails.length > 0, `verifier missed: ${label}`);
      psql(restoreSql);
      assert.match(verify(), /SUMMARY\|violations\|0\|?\s*$/, `not restored: ${label}`);
    };
    deviate(
      'runtime gains DELETE on payments',
      `GRANT DELETE ON payments TO ${R.runtime}`,
      `REVOKE DELETE ON payments FROM ${R.runtime}`,
    );
    deviate(
      'runtime gains UPDATE on audit_events',
      `GRANT UPDATE ON audit_events TO ${R.runtime}`,
      `REVOKE UPDATE ON audit_events FROM ${R.runtime}`,
    );
    deviate(
      'read-only gains INSERT on residents',
      `GRANT INSERT ON residents TO ${R.readonly}`,
      `REVOKE INSERT ON residents FROM ${R.readonly}`,
    );
    deviate(
      'runtime loses UPDATE on beds',
      `REVOKE UPDATE ON beds FROM ${R.runtime}`,
      `GRANT UPDATE ON beds TO ${R.runtime}`,
    );
    console.log(JSON.stringify({ result: 'roles-grants rehearsal passed', tables: tableCount }));
  }
} catch (error) {
  console.error(
    `Pilot phase 1 rehearsal failed: ${error instanceof assert.AssertionError ? error.message : 'provisioning or test error; sensitive driver output withheld'}`,
  );
  process.exitCode = 1;
} finally {
  for (const c of clients.reverse()) await c.end().catch(() => {});
  if (created) {
    const label = docker([
      'inspect',
      '--format',
      '{{index .Config.Labels "nook.pilot1.run"}}',
      name,
    ]);
    assert.equal(label, runId, 'Refusing cleanup of a resource not created by this run');
    docker(['stop', '--time', '5', name]);
    const remaining = docker([
      'ps',
      '-a',
      '--filter',
      `label=nook.pilot1.run=${runId}`,
      '--format',
      '{{.ID}}',
    ]);
    assert.equal(remaining, '', 'Disposable container still present');
    console.log(
      `CLEANUP VERIFIED ${runId}: exact container removed; tmpfs discarded; no volumes created or deleted.`,
    );
  }
}
