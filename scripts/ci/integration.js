import { withTestProtocol } from './integration-test-reporter.js';
import { createDiagnostics } from './diagnostics.js';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { deployFull, assertG6BEnvironment, supervise, ROOT } from './g6b-migration.js';
import { TARGET } from './g6b-preflight.js';
import { assertG6AAuthorization, deployFoundation } from './g6a-migration.js';
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
const abort = new AbortController();
let terminationUncertain = false;
const quoteIdentifier = (value) => '"' + value.replaceAll('"', '""') + '"';
const quoteLiteral = (value) => "'" + value.replaceAll("'", "''") + "'";
const clients = [];
const diagnostics = createDiagnostics();

async function connect(options) {
  const client = new Client({
    ...options,
    connectionTimeoutMillis: 5000,
    ...(process.argv[2] === 'full' ? { query_timeout: 10000, statement_timeout: 10000 } : {}),
  });
  // Idle Client errors are emitted outside query promises and bypass main()'s catch.
  // Fail closed without Node printing the raw driver error; exit closes all sockets.
  client.on('error', (error) => {
    console.error(`CI provisioning connection lost (${sanitizeDriverError(error)}).`);
    if (process.argv[2] === 'full') {
      abort.abort();
      process.exitCode = 1;
    } else process.exit(1);
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

async function grantRuntime(owner, runtime) {
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
}

async function main() {
  const profile = process.argv[2];
  const target = profiles[profile];
  diagnostics.runSync('hosted_environment_validation', () => {
    if (
      !target ||
      process.argv.length !== 3 ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      process.env.GITHUB_JOB !==
        (profile === 'full' ? 'full-integration' : 'initial-integration') ||
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
  });
  const runtime = `nook_ci_${target.suffix}_runtime`;
  const migrator = `nook_ci_${target.suffix}_migrator`;
  const runtimePassword = secret();
  const migratorPassword = secret();
  const ownerPassword = secret();
  const verifierPassword = profile === 'full' ? secret() : undefined;
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
  diagnostics.runSync('hosted_environment_validation', () => {
    validateEnvironment(env); // Pure guard validation before the first connection.
    if (profile === 'full') assertG6BEnvironment(process.env, env);
  });
  const admin = await diagnostics.run('postgres_service_readiness', () =>
    connect({
      ...endpoint,
      database: 'postgres',
      user: 'postgres',
      password: process.env.CI_BOOTSTRAP_PASSWORD,
    }),
  );
  const bootstrap = await diagnostics.run('bootstrap_validation', async () => {
    // Refuse any reused cluster before making changes, including all protected/scratch databases.
    const databases = (
      await admin.query('SELECT datname FROM pg_database ORDER BY datname')
    ).rows.map((row) => row.datname);
    if (JSON.stringify(databases) !== JSON.stringify(['postgres', 'template0', 'template1'])) {
      throw new Error('Fresh service cluster required');
    }
    const bootstrap = {
      databases,
      ...(
        await admin.query(
          'SELECT inet_server_addr()::text AS server, inet_server_port() AS "serverPort", pg_postmaster_start_time()::text AS postmaster',
        )
      ).rows[0],
    };
    return bootstrap;
  });
  const databases = bootstrap.databases;
  await diagnostics.run('role_provisioning', async () => {
    for (const [role, password] of [
      [runtime, runtimePassword],
      [migrator, migratorPassword],
      ...(profile === 'full' ? [[TARGET.verifier, verifierPassword]] : []),
    ]) {
      await admin.query(
        `CREATE ROLE ${quoteIdentifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quoteLiteral(password)}`,
      );
    }
  });
  await diagnostics.run('database_provisioning', async () => {
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
    if (profile !== 'full') {
      await admin.end();
      clients.splice(clients.indexOf(admin), 1);
    } else
      await admin.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(target.database)} TO ${quoteIdentifier(TARGET.verifier)}`,
      );
  });

  const owner = await diagnostics.run('database_identity_preflight', async () => {
    const owner = await connect({
      ...endpoint,
      database: target.database,
      user: migrator,
      password: migratorPassword,
    });
    await owner.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(runtime)}`);
    return owner;
  });
  if (profile === 'initial-migration') {
    await deployFoundation(owner, env.MIGRATOR_DATABASE_URL);
  } else {
    const make = (role, password) =>
      connect({ ...endpoint, database: target.database, user: role, password });
    const lockClient = await make(migrator, migratorPassword);
    const runtimeClient = await make(runtime, runtimePassword);
    const verifier = await make(TARGET.verifier, verifierPassword);
    const files = JSON.parse(readFileSync(new URL('./test-files.json', import.meta.url), 'utf8'));
    const run = (args) => {
      const execute = (onOutput) =>
        supervise(
          process.execPath,
          ['--import', 'tsx', ...args],
          {
            env:
              args[0] === '--test'
                ? { ...env, TSX_TSCONFIG_PATH: resolve(ROOT, 'apps/api/tsconfig.json') }
                : env,
            cwd: process.cwd(),
          },
          {
            signal: abort.signal,
            timeout: 20 * 60 * 1000,
            diagnostics,
            identity: args[0] === 'scripts/ci/seed-fixtures.js' ? 'fixtures' : 'integration_tests',
            onOutput,
          },
        );
      return args[0] === '--test'
        ? withTestProtocol(execute, (line) => console.log(line))
        : execute();
    };
    await deployFull({
      diagnostics,
      hosted: process.env,
      env,
      bootstrap,
      owner,
      lockClient,
      runtime: runtimeClient,
      verifier,
      abort,
      grantVerifier: async () => {
        await owner.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(TARGET.verifier)}`);
        await owner.query(
          `GRANT SELECT ON TABLE public._prisma_migrations TO ${quoteIdentifier(TARGET.verifier)}`,
        );
      },
      grants: () => grantRuntime(owner, runtime),
      fixtures: () => run(['scripts/ci/seed-fixtures.js']),
      tests: () =>
        run([
          '--test',
          '--test-concurrency=1',
          '--test-reporter=./scripts/ci/integration-test-reporter.js',
          ...files.full.map((name) => `apps/api/test/integration/${name}.integration.test.ts`),
        ]),
      cleanup: async (state) => {
        terminationUncertain = state.terminationUncertain;
        if (terminationUncertain) {
          // Keep the lock session alive until hosted job timeout tears down the disposable service.
          // Never intentionally unlock while an engine might still be running.
          process.exitCode = 1;
          console.error('G6B termination uncertain; blocked pending hosted service teardown.');
          return;
        }
        const closing = clients.filter((c) => c !== admin);
        const results = await Promise.allSettled(closing.map((c) => c.end()));
        for (const c of closing) clients.splice(clients.indexOf(c), 1);
        if (results.some((r) => r.status === 'rejected'))
          throw new Error('G6B connection cleanup uncertain');
        for (let attempt = 0; attempt < 20; attempt++) {
          const { rows } = await admin.query(
            `SELECT
            (SELECT count(*) FROM pg_stat_activity WHERE datname=$1)::int AS sessions,
            (SELECT count(*) FROM pg_locks l JOIN pg_database d ON d.oid=l.database WHERE d.datname=$1 AND l.locktype='advisory')::int AS locks`,
            [target.database],
          );
          if (rows[0].sessions === 0 && rows[0].locks === 0) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('G6B postrun sessions or locks remain');
      },
    });
    return;
  }
  await grantRuntime(owner, runtime);
  await owner.end();
  clients.splice(clients.indexOf(owner), 1);

  const files = JSON.parse(readFileSync(new URL('./test-files.json', import.meta.url), 'utf8'));
  const tests = files['initial-migration'].map((name) => `apps/api/test/${name}.test.ts`);
  child(['--test', '--test-concurrency=1', ...tests], env);
}
let primaryError;
try {
  await main();
} catch (error) {
  primaryError = error;
  // Never emit SQL text, connection strings, driver messages, or child environment values.
  diagnostics.report(error);
  process.exitCode = 1;
} finally {
  if (!terminationUncertain) {
    try {
      await diagnostics.run('cleanup', async () => {
        const results = await Promise.allSettled(clients.map((client) => client.end()));
        if (results.some((result) => result.status === 'rejected')) {
          throw new Error('CI connection cleanup uncertain.');
        }
      });
    } catch (error) {
      diagnostics.report(error);
      process.exitCode = 1;
    }
  }
  if (primaryError) diagnostics.report(primaryError);
}
