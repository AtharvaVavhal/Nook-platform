import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { assertG6AAuthorization, deployFoundation, FOUNDATION } from './g6a-migration.js';
import {
  DATABASE_MARKER,
  validateEnvironment,
  sanitizeDriverError,
} from '../../apps/api/test/integration/helpers/guard.ts';

// No operator-supplied target: the two profiles have fixed, CI-only loopback endpoints.
const profiles = {
  'initial-migration': { database: 'nook_integration_ci_initial', port: 5544, suffix: 'initial' },
  full: { database: 'nook_integration_ci_full', port: 5545, suffix: 'full' },
};
const initialMigration = FOUNDATION;
const quoteIdentifier = (value) => '"' + value.replaceAll('"', '""') + '"';
const quoteLiteral = (value) => "'" + value.replaceAll("'", "''") + "'";
const clients = [];

async function connect(options) {
  const client = new Client({ ...options, connectionTimeoutMillis: 5000 });
  // Idle Client errors are emitted outside query promises and bypass main()'s catch.
  // Fail closed without Node printing the raw driver error; exit closes all sockets.
  client.on('error', (error) => {
    console.error(`CI provisioning connection lost (${sanitizeDriverError(error)}).`);
    process.exit(1);
  });
  clients.push(client);
  await client.connect();
  return client;
}
function child(args, env) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', ...args], {
    env,
    stdio: 'inherit',
    timeout: 20 * 60 * 1000,
  });
  if (result.status !== 0) throw new Error('CI child failed');
}
function secret() {
  const value = randomBytes(32).toString('hex');
  // GitHub interprets this as a masking command; never print a credential as ordinary output.
  process.stdout.write(`::add-mask::${value}\n`);
  return value;
}

async function main() {
  const profile = process.argv[2];
  const target = profiles[profile];
  if (
    !target ||
    process.argv.length !== 3 ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    process.env.GITHUB_JOB !== (profile === 'full' ? 'full-integration' : 'initial-integration') ||
    !process.env.CI_BOOTSTRAP_PASSWORD
  ) {
    throw new Error('Hosted CI profile required');
  }
  if (profile === 'initial-migration') assertG6AAuthorization(process.env);
  // Do not let pg fall back to ambient connection/TLS options, even during provisioning.
  if (
    Object.keys(process.env).some(
      (key) => /^PG[A-Z0-9_]*$/.test(key) || key === 'NODE_TLS_REJECT_UNAUTHORIZED',
    )
  ) {
    throw new Error('Ambient driver configuration forbidden');
  }
  const runtime = `nook_ci_${target.suffix}_runtime`;
  const migrator = `nook_ci_${target.suffix}_migrator`;
  const runtimePassword = secret();
  const migratorPassword = secret();
  const ownerPassword = secret();
  const endpoint = { host: '127.0.0.1', port: target.port, ssl: false };
  const url = (role, password) =>
    `postgresql://${role}:${password}@127.0.0.1:${target.port}/${target.database}`;
  const env = {
    PATH: process.env.PATH,
    APP_ENV: 'test',
    NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB: '1',
    NOOK_INTEGRATION_PROFILE: profile,
    NOOK_DATABASE_TESTS_REQUIRED: '1',
    DATABASE_URL: url(runtime, runtimePassword),
    MIGRATOR_DATABASE_URL: url(migrator, migratorPassword),
    TEST_OWNER_PASSWORD: ownerPassword,
  };
  validateEnvironment(env); // Pure guard validation before the first connection.
  const admin = await connect({
    ...endpoint,
    database: 'postgres',
    user: 'postgres',
    password: process.env.CI_BOOTSTRAP_PASSWORD,
  });
  // Refuse any reused cluster before making changes, including all protected/scratch databases.
  const databases = (
    await admin.query('SELECT datname FROM pg_database ORDER BY datname')
  ).rows.map((row) => row.datname);
  if (JSON.stringify(databases) !== JSON.stringify(['postgres', 'template0', 'template1'])) {
    throw new Error('Fresh service cluster required');
  }
  for (const [role, password] of [
    [runtime, runtimePassword],
    [migrator, migratorPassword],
  ]) {
    await admin.query(
      `CREATE ROLE ${quoteIdentifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quoteLiteral(password)}`,
    );
  }
  for (const database of databases) {
    await admin.query(`REVOKE ALL ON DATABASE ${quoteIdentifier(database)} FROM PUBLIC`);
  }
  await admin.query(
    `CREATE DATABASE ${quoteIdentifier(target.database)} OWNER ${quoteIdentifier(migrator)}`,
  );
  await admin.query(`REVOKE ALL ON DATABASE ${quoteIdentifier(target.database)} FROM PUBLIC`);
  await admin.query(
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(target.database)} TO ${quoteIdentifier(runtime)}`,
  );
  await admin.query(
    `COMMENT ON DATABASE ${quoteIdentifier(target.database)} IS ${quoteLiteral(DATABASE_MARKER)}`,
  );
  await admin.end();
  clients.splice(clients.indexOf(admin), 1);

  const owner = await connect({
    ...endpoint,
    database: target.database,
    user: migrator,
    password: migratorPassword,
  });
  await owner.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(runtime)}`);
  if (profile === 'initial-migration') {
    await deployFoundation(owner, env.MIGRATOR_DATABASE_URL);
  } else {
    // Full profile is unchanged and is not reachable through the dedicated G6A workflow.
    const available = readdirSync('prisma/migrations', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (available[0] !== initialMigration) throw new Error('Initial migration changed; review CI');
    for (const migration of available) {
      await owner.query('BEGIN');
      await owner.query(readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
      await owner.query('COMMIT');
    }
  }
  const tables = (
    await owner.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    )
  ).rows;
  for (const { tablename } of tables) {
    const privileges = tablename === 'audit_events' ? 'SELECT, INSERT' : 'SELECT, INSERT, UPDATE';
    await owner.query(
      `GRANT ${privileges} ON TABLE public.${quoteIdentifier(tablename)} TO ${quoteIdentifier(runtime)}`,
    );
  }
  await owner.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdentifier(runtime)}`,
  );
  await owner.end();
  clients.splice(clients.indexOf(owner), 1);

  const files = JSON.parse(readFileSync(new URL('./test-files.json', import.meta.url), 'utf8'));
  if (profile === 'full') child(['scripts/ci/seed-fixtures.js'], env);
  const tests = files[profile].map((name) =>
    profile === 'full'
      ? `apps/api/test/integration/${name}.integration.test.ts`
      : `apps/api/test/${name}.test.ts`,
  );
  child(['--test', '--test-concurrency=1', ...tests], env);
}
try {
  await main();
} catch (error) {
  // Never emit SQL text, connection strings, driver messages, or child environment values.
  console.error(`CI integration setup/test failed (${sanitizeDriverError(error)}).`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
}
