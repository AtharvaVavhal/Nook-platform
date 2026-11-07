import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect } from 'node:util';
import {
  ALLOWED_MIGRATOR_MEMBERSHIPS,
  DATABASE_MARKER,
  FULL_APPLICATION_TABLES,
  INITIAL_MIGRATION_TABLES,
  IntegrationGuardError,
  OPT_IN_VARIABLE,
  OTHER_DRIVER_VARIABLES,
  PROFILE_VARIABLE,
  REVIEWED_PG_VARIABLES,
  ambientDriverVariables,
  assertTestOwnedObjectName,
  connectionStringOf,
  sanitizeDriverError,
  validateEnvironment,
  verifyIdentity,
  type IntegrationConfig,
  type MigratorFacts,
  type OwnershipFacts,
  type RuntimeFacts,
  type ServerFacts,
  type SessionFacts,
} from './integration/helpers/guard.js';

// Pure tests of the integration-suite guard. Nothing here connects to PostgreSQL: URLs are parsed and the
// identity checks are fed mock facts. The passwords and values below are placeholders, not real credentials.

const SECRET = 'unit-test-placeholder-secret';
const RUNTIME = `postgresql://nook_it_runtime:${SECRET}@127.0.0.1:55433/nook_integration_isolated`;
const MIGRATOR = `postgresql://nook_it_migrator:${SECRET}@127.0.0.1:55433/nook_integration_isolated`;

const goodEnv = (over: Record<string, string | undefined> = {}) => ({
  [OPT_IN_VARIABLE]: '1',
  DATABASE_URL: RUNTIME,
  MIGRATOR_DATABASE_URL: MIGRATOR,
  TEST_OWNER_PASSWORD: SECRET,
  ...over,
});

/** A refusal that names the rule, never a URL, a user, or the secret. */
function refused(env: Record<string, string | undefined>, pattern: RegExp) {
  assert.throws(
    () => validateEnvironment(env),
    (error) => {
      assert.ok(error instanceof IntegrationGuardError, 'throws the guard error');
      assert.match(error.message, pattern);
      assert.ok(!error.message.includes(SECRET), 'message must not contain the secret');
      assert.ok(
        !/:\/\/\S*@/.test(error.message),
        'message must not contain a URL with credentials',
      );
      assert.ok(!error.message.includes('nook_it_'), 'message must not contain a role name');
      return true;
    },
  );
}

// ------------------------------------------------------------------ environment and URLs

test('a correct environment is accepted and parsed strictly', () => {
  const config = validateEnvironment(goodEnv());
  assert.equal(config.runtime.database, 'nook_integration_isolated');
  assert.equal(config.runtime.port, 55433);
  assert.equal(config.runtime.host, '127.0.0.1');
  assert.equal(config.migrator.username, 'nook_it_migrator');
  assert.equal(config.profile, 'full');
  // the schema=public parameter some tooling appends is the only one tolerated
  assert.doesNotThrow(() =>
    validateEnvironment(goodEnv({ DATABASE_URL: `${RUNTIME}?schema=public` })),
  );
});

test('1. the opt-in variable is required, and only the exact value 1 counts', () => {
  refused(
    goodEnv({ [OPT_IN_VARIABLE]: undefined }),
    /NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1 is required/,
  );
  for (const value of ['', '0', 'true', 'yes', '01', ' 1']) {
    refused(goodEnv({ [OPT_IN_VARIABLE]: value }), /opt-in/);
  }
});

test('2. a missing or blank runtime URL is refused', () => {
  refused(goodEnv({ DATABASE_URL: undefined }), /DATABASE_URL is not set/);
  refused(goodEnv({ DATABASE_URL: '   ' }), /DATABASE_URL is not set/);
});

test('3. a missing migrator URL is refused', () => {
  refused(goodEnv({ MIGRATOR_DATABASE_URL: undefined }), /MIGRATOR_DATABASE_URL is not set/);
});

test('4. a missing test-owner password is refused', () => {
  refused(goodEnv({ TEST_OWNER_PASSWORD: undefined }), /TEST_OWNER_PASSWORD is not set/);
  refused(goodEnv({ TEST_OWNER_PASSWORD: '' }), /TEST_OWNER_PASSWORD is not set/);
});

test('5. nook_dev is refused on either URL, whatever else is right', () => {
  const dev = (u: string) => u.replace('nook_integration_isolated', 'nook_dev');
  refused(
    goodEnv({ DATABASE_URL: dev(RUNTIME), MIGRATOR_DATABASE_URL: dev(MIGRATOR) }),
    /protected database/,
  );
  refused(
    goodEnv({ MIGRATOR_DATABASE_URL: dev(MIGRATOR) }),
    /MIGRATOR_DATABASE_URL names a protected/,
  );
});

test('6. nook_test is refused on either URL', () => {
  const t = (u: string) => u.replace('nook_integration_isolated', 'nook_test');
  refused(
    goodEnv({ DATABASE_URL: t(RUNTIME), MIGRATOR_DATABASE_URL: t(MIGRATOR) }),
    /protected database/,
  );
  refused(goodEnv({ DATABASE_URL: t(RUNTIME) }), /DATABASE_URL names a protected/);
});

test('7. scratch and look-alike databases are refused: only nook_integration_* passes', () => {
  for (const name of [
    'nook_4f1_scratch',
    'nook_layer1_clean',
    'nook_repro_20261103',
    'nook_restore_drill_20261103',
    'nook_integration', // no suffix
    'nook_integration_', // empty suffix
    'NOOK_INTEGRATION_X', // case
    'x_nook_integration_a', // prefix trick
    'nook_integration_a-b', // punctuation
    'postgres',
  ]) {
    const swap = (u: string) => u.replace('nook_integration_isolated', name);
    refused(
      goodEnv({ DATABASE_URL: swap(RUNTIME), MIGRATOR_DATABASE_URL: swap(MIGRATOR) }),
      /nook_integration_\*/,
    );
  }
});

test('8. remote and look-alike hosts are refused', () => {
  for (const host of [
    'db.example.com',
    '10.0.0.5',
    '192.168.1.20',
    'localhost.evil.com',
    '127.0.0.1.evil.com',
    '0.0.0.0',
    '127.0.0.2',
  ]) {
    const swap = (u: string) => u.replace('127.0.0.1', host);
    refused(
      goodEnv({ DATABASE_URL: swap(RUNTIME), MIGRATOR_DATABASE_URL: swap(MIGRATOR) }),
      /loopback/,
    );
  }
  for (const host of ['localhost', 'LOCALHOST', '[::1]']) {
    const swap = (u: string) => u.replace('127.0.0.1', host);
    assert.doesNotThrow(() =>
      validateEnvironment(
        goodEnv({ DATABASE_URL: swap(RUNTIME), MIGRATOR_DATABASE_URL: swap(MIGRATOR) }),
      ),
    );
  }
});

test('9. port 5432 is refused', () => {
  const swap = (u: string) => u.replace('55433', '5432');
  refused(
    goodEnv({ DATABASE_URL: swap(RUNTIME), MIGRATOR_DATABASE_URL: swap(MIGRATOR) }),
    /forbidden port/,
  );
});

test('10. port 5433 is refused', () => {
  const swap = (u: string) => u.replace('55433', '5433');
  refused(
    goodEnv({ DATABASE_URL: swap(RUNTIME), MIGRATOR_DATABASE_URL: swap(MIGRATOR) }),
    /forbidden port/,
  );
});

test('a missing or out-of-range port is refused', () => {
  const noPort = (u: string) => u.replace(':55433', '');
  refused(
    goodEnv({ DATABASE_URL: noPort(RUNTIME), MIGRATOR_DATABASE_URL: noPort(MIGRATOR) }),
    /explicit port/,
  );
  const low = (u: string) => u.replace('55433', '80');
  refused(
    goodEnv({ DATABASE_URL: low(RUNTIME), MIGRATOR_DATABASE_URL: low(MIGRATOR) }),
    /invalid port/,
  );
});

test('11. runtime and migrator URLs naming different databases are refused', () => {
  refused(
    goodEnv({
      MIGRATOR_DATABASE_URL: MIGRATOR.replace(
        'nook_integration_isolated',
        'nook_integration_other',
      ),
    }),
    /different databases/,
  );
});

test('12. runtime and migrator URLs on different servers are refused', () => {
  refused(
    goodEnv({ MIGRATOR_DATABASE_URL: MIGRATOR.replace('55433', '55434') }),
    /different ports/,
  );
  refused(
    goodEnv({ MIGRATOR_DATABASE_URL: MIGRATOR.replace('127.0.0.1', 'localhost') }),
    /different hosts/,
  );
  // one role used for both would defeat the privilege split
  refused(goodEnv({ MIGRATOR_DATABASE_URL: RUNTIME }), /different roles/);
});

const MALFORMED = [
  'not a url',
  'postgresql://',
  `postgresql://u:${SECRET}@127.0.0.1:55433`,
  `postgresql://u:${SECRET}@127.0.0.1:55433/`,
  `postgresql://u:${SECRET}@127.0.0.1:55433/a/b`,
  `postgresql://u:${SECRET}@127.0.0.1:55433,evil.example:5432/nook_integration_x`,
  `postgresql://u:${SECRET}@127.0.0.1:99999/nook_integration_x`,
  `postgresql://127.0.0.1:55433/nook_integration_x`, // no user
  `mysql://u:${SECRET}@127.0.0.1:55433/nook_integration_x`,
  `http://u:${SECRET}@127.0.0.1:55433/nook_integration_x`,
  `postgresql://u:${SECRET}@127.0.0.1:55433/nook_integration_x#frag`,
  `postgresql://u:${SECRET}@127.0.0.1:55433/nook%5Fintegration_x`,
  `postgresql://u%ZZ:${SECRET}@127.0.0.1:55433/nook_integration_x`,
  ` ${RUNTIME}`,
  `${RUNTIME} `,
  `postgresql://u:${SECRET}@127.0.0.1:55433/nook_integration_x?sslmode=disable&password=${SECRET}`,
];

test('13. malformed URLs are refused without echoing them', () => {
  for (const bad of MALFORMED) {
    refused(goodEnv({ DATABASE_URL: bad }), /DATABASE_URL/);
    refused(goodEnv({ MIGRATOR_DATABASE_URL: bad }), /MIGRATOR_DATABASE_URL/);
  }
});

test('14. query parameters that could redirect the connection or change TLS are refused', () => {
  for (const q of [
    'sslmode=disable',
    'sslmode=require',
    'host=db.example.com',
    'hostaddr=10.0.0.5',
    'port=5432',
    'dbname=nook_dev',
    'options=-c%20search_path%3Devil',
    'application_name=x',
    'service=prod',
    'schema=other',
    'schema=public&sslmode=disable',
    'schema=public&schema=public',
    '',
  ]) {
    refused(goodEnv({ MIGRATOR_DATABASE_URL: `${MIGRATOR}?${q}` }), /query/);
  }
});

// ------------------------------------------------------------------ F2: ambient driver environment

test('F2. every reviewed PG variable is refused by name, whatever its value, and the value is never printed', () => {
  assert.ok(REVIEWED_PG_VARIABLES.length >= 20);
  for (const name of REVIEWED_PG_VARIABLES) {
    for (const value of ['fake-ambient-value', '', '0']) {
      assert.throws(
        () => validateEnvironment(goodEnv({ [name]: value })),
        (error) => {
          assert.ok(error instanceof IntegrationGuardError);
          assert.match(error.message, new RegExp(`${name} is set`));
          assert.ok(!error.message.includes('fake-ambient-value'), 'the value is never printed');
          return true;
        },
        `${name}=${JSON.stringify(value)}`,
      );
    }
  }
});

test('F2. the PG prefix rule also catches variables nobody listed', () => {
  for (const name of ['PGFUTUREOPTION', 'PGGSSENCMODE', 'PGLOADBALANCEHOSTS', 'PGDATA', 'PG']) {
    refused(goodEnv({ [name]: 'x' }), new RegExp(`${name} is set`));
  }
  assert.deepEqual(
    ambientDriverVariables({
      PGHOST: 'a',
      PGSSLMODE: 'b',
      PATH: '/bin',
      HOME: '/h',
      PGX: undefined,
    }),
    ['PGHOST', 'PGSSLMODE'],
  );
});

test('F2. variables that change TLS verification are refused; ordinary variables are not', () => {
  for (const name of OTHER_DRIVER_VARIABLES) refused(goodEnv({ [name]: '0' }), new RegExp(name));
  assert.doesNotThrow(() =>
    validateEnvironment(goodEnv({ PATH: '/usr/bin', HOME: '/home/x', APP_ENV: 'test', LANG: 'C' })),
  );
});

test('F2. several offenders are all reported, sorted, by name only', () => {
  assert.throws(
    () => validateEnvironment(goodEnv({ PGSSLMODE: 'v1', PGHOST: 'v2', PGOPTIONS: 'v3' })),
    (error) => {
      assert.ok(error instanceof IntegrationGuardError);
      const names = error.reasons.map((r) => /(PG[A-Z]+) is set/.exec(r)?.[1]).filter(Boolean);
      assert.deepEqual(names, ['PGHOST', 'PGOPTIONS', 'PGSSLMODE']);
      assert.ok(!/v[123]/.test(error.message));
      return true;
    },
  );
});

// ------------------------------------------------------------------ profiles

test('the profile defaults to full, accepts initial-migration, and refuses anything else', () => {
  assert.equal(validateEnvironment(goodEnv()).profile, 'full');
  assert.equal(validateEnvironment(goodEnv({ [PROFILE_VARIABLE]: 'full' })).profile, 'full');
  assert.equal(
    validateEnvironment(goodEnv({ [PROFILE_VARIABLE]: 'initial-migration' })).profile,
    'initial-migration',
  );
  for (const bad of ['', 'FULL', 'initial', 'all', 'full ']) {
    refused(goodEnv({ [PROFILE_VARIABLE]: bad }), /NOOK_INTEGRATION_PROFILE/);
  }
});

// ------------------------------------------------------------------ F7: no credential leakage

test('F7. the configuration object carries no password and no URL, however it is printed', () => {
  const config = validateEnvironment(goodEnv());
  for (const rendered of [
    JSON.stringify(config),
    inspect(config, { depth: 5, showHidden: true }),
    String(Object.values(config.runtime)),
    JSON.stringify(Object.getOwnPropertyNames(config.migrator)),
  ]) {
    assert.ok(!rendered.includes(SECRET), 'no secret in any rendering');
    assert.ok(!/postgres(ql)?:\/\//.test(rendered), 'no URL in any rendering');
  }
  // an assertion diff prints both sides: confirm a failing deepEqual on the config leaks nothing
  assert.throws(
    () => assert.deepEqual(config, { runtime: {}, migrator: {}, profile: 'x' }),
    (error) => {
      assert.ok(error instanceof assert.AssertionError);
      assert.ok(!String(error.message).includes(SECRET));
      return true;
    },
  );
});

test('F7. the driver string is reachable only through connectionStringOf, and only for guarded objects', () => {
  const config = validateEnvironment(goodEnv());
  assert.equal(connectionStringOf(config.runtime), RUNTIME);
  assert.equal(connectionStringOf(config.migrator), MIGRATOR);
  // a hand-built look-alike never yields a connection string, and the error does not echo anything
  const forged = {
    host: '127.0.0.1',
    port: 55433,
    database: 'nook_integration_isolated',
    username: 'x',
  };
  assert.throws(
    () => connectionStringOf(forged),
    (error) => error instanceof IntegrationGuardError && !error.message.includes(SECRET),
  );
  assert.ok(Object.isFrozen(config.runtime), 'the metadata cannot be edited after validation');
});

test('F7. deliberately malformed URLs carrying a fake password never expose it, in any message or reason', () => {
  for (const bad of MALFORMED) {
    for (const variable of ['DATABASE_URL', 'MIGRATOR_DATABASE_URL']) {
      try {
        validateEnvironment(goodEnv({ [variable]: bad }));
        assert.fail(`expected a refusal for a malformed ${variable}`);
      } catch (error) {
        assert.ok(error instanceof IntegrationGuardError, 'the guard error, not a raw one');
        const everything = `${error.message}\n${error.reasons.join('\n')}\n${error.stack ?? ''}`;
        assert.ok(
          !everything.includes(SECRET),
          'the password is not in the message, reasons or stack',
        );
      }
    }
  }
});

test('F7. driver errors are reduced to a code; their messages, which can carry details, are dropped', () => {
  const leaky = Object.assign(new Error(`password authentication failed ${SECRET} at 127.0.0.1`), {
    code: '28P01',
  });
  assert.equal(sanitizeDriverError(leaky), '28P01');
  assert.equal(
    sanitizeDriverError(Object.assign(new Error(SECRET), { code: 'ECONNREFUSED' })),
    'ECONNREFUSED',
  );
  for (const unknown of [
    new Error(SECRET),
    Object.assign(new Error('x'), { code: `custom ${SECRET}` }),
    Object.assign(new Error('x'), { code: 'lowercase' }),
    Object.assign(new Error('x'), { code: 12345 }),
    SECRET,
    null,
    undefined,
    {},
  ]) {
    assert.equal(sanitizeDriverError(unknown), 'unknown');
  }
});

// ------------------------------------------------------------------ identity and privileges (mock facts)

const config: IntegrationConfig = validateEnvironment(goodEnv());
const initialConfig: IntegrationConfig = validateEnvironment(
  goodEnv({ [PROFILE_VARIABLE]: 'initial-migration' }),
);

const session = (over: Partial<SessionFacts> = {}): SessionFacts => ({
  database: 'nook_integration_isolated',
  currentUser: 'nook_it_runtime',
  sessionUser: 'nook_it_runtime',
  serverAddr: '172.17.0.2',
  serverPort: 5432,
  inRecovery: false,
  postmasterStart: '2026-11-03 10:00:00+00',
  systemIdentifier: '7500000000000000001',
  marker: DATABASE_MARKER,
  ...over,
});
const plainRole = {
  superuser: false,
  createdb: false,
  createrole: false,
  bypassrls: false,
  replication: false,
};

const ownership = (over: Partial<OwnershipFacts> = {}): OwnershipFacts => ({
  ownsDatabase: false,
  ownedSchemas: 0,
  ownedFunctions: 0,
  applicationTables: [...FULL_APPLICATION_TABLES],
  ownedTables: [],
  memberOf: [],
  ...over,
});
const cleanPrivileges = {
  forbiddenTablePrivileges: 0,
  canModifyAuditEvents: false,
  canTruncateAuditEvents: false,
  canCreateInSchemaPublic: false,
  canCreateInDatabase: false,
};

const runtimeFacts = (over: Partial<RuntimeFacts> = {}): RuntimeFacts => ({
  session: session(),
  role: { ...plainRole },
  ownership: ownership(),
  privileges: { ...cleanPrivileges },
  connectableOtherDatabases: [],
  ...over,
});
const migratorFacts = (over: Partial<MigratorFacts> = {}): MigratorFacts => ({
  session: session({ currentUser: 'nook_it_migrator', sessionUser: 'nook_it_migrator' }),
  role: { ...plainRole },
  ownership: ownership({ ownsDatabase: true, ownedTables: [...FULL_APPLICATION_TABLES] }),
  ...over,
});
const cleanServer: ServerFacts = { protectedDatabases: [] };

function identityRefused(
  runtime: RuntimeFacts,
  migrator: MigratorFacts,
  pattern: RegExp,
  server: ServerFacts = cleanServer,
  cfg: IntegrationConfig = config,
) {
  assert.throws(
    () => verifyIdentity(cfg, runtime, migrator, server),
    (error) => error instanceof IntegrationGuardError && pattern.test(error.message),
  );
}

test('correct identity, ownership and privilege facts are accepted', () => {
  assert.doesNotThrow(() => verifyIdentity(config, runtimeFacts(), migratorFacts(), cleanServer));
  // the migrator's only allowed membership is PostgreSQL's implicit database-owner role
  assert.deepEqual(ALLOWED_MIGRATOR_MEMBERSHIPS, ['pg_database_owner']);
  assert.doesNotThrow(() =>
    verifyIdentity(
      config,
      runtimeFacts(),
      migratorFacts({
        ownership: ownership({
          ownsDatabase: true,
          ownedTables: [...FULL_APPLICATION_TABLES],
          memberOf: ['pg_database_owner'],
        }),
      }),
      cleanServer,
    ),
  );
});

test('15. a missing or wrong database marker is refused on either connection', () => {
  identityRefused(runtimeFacts({ session: session({ marker: null }) }), migratorFacts(), /marker/);
  identityRefused(
    runtimeFacts(),
    migratorFacts({
      session: session({
        currentUser: 'nook_it_migrator',
        sessionUser: 'nook_it_migrator',
        marker: 'disposable',
      }),
    }),
    /marker/,
  );
  identityRefused(
    runtimeFacts({ session: session({ marker: `${DATABASE_MARKER} ` }) }),
    migratorFacts(),
    /marker/,
  );
});

test('16. a runtime superuser (or any elevated runtime attribute, including REPLICATION) is refused', () => {
  for (const [attribute, pattern] of [
    ['superuser', /runtime role is a superuser/],
    ['createdb', /runtime role has CREATEDB/],
    ['createrole', /runtime role has CREATEROLE/],
    ['bypassrls', /runtime role has BYPASSRLS/],
    ['replication', /runtime role has REPLICATION/],
  ] as const) {
    identityRefused(
      runtimeFacts({ role: { ...plainRole, [attribute]: true } }),
      migratorFacts(),
      pattern,
    );
  }
});

test('17. a runtime role that owns application tables is refused', () => {
  identityRefused(
    runtimeFacts({ ownership: ownership({ ownedTables: ['beds'] }) }),
    migratorFacts(),
    /runtime role owns application tables/,
  );
});

test('18. a runtime role with TRUNCATE on audit_events is refused', () => {
  identityRefused(
    runtimeFacts({ privileges: { ...cleanPrivileges, canTruncateAuditEvents: true } }),
    migratorFacts(),
    /TRUNCATE on audit_events/,
  );
});

test('the runtime role may not reach other databases on the server', () => {
  identityRefused(
    runtimeFacts({ connectableOtherDatabases: ['nook_dev'] }),
    migratorFacts(),
    /connect to other databases/,
  );
});

test('F6. the runtime role may not own the database, a schema or a function', () => {
  identityRefused(
    runtimeFacts({ ownership: ownership({ ownsDatabase: true }) }),
    migratorFacts(),
    /runtime role owns the database/,
  );
  identityRefused(
    runtimeFacts({ ownership: ownership({ ownedSchemas: 1 }) }),
    migratorFacts(),
    /runtime role owns a schema/,
  );
  identityRefused(
    runtimeFacts({ ownership: ownership({ ownedFunctions: 2 }) }),
    migratorFacts(),
    /runtime role owns functions/,
  );
});

test('F6. any role membership on the runtime role is refused, including predefined privileged roles', () => {
  for (const role of [
    'pg_read_all_data',
    'pg_write_all_data',
    'pg_maintain',
    'pg_execute_server_program',
    'pg_monitor',
    'nook_it_migrator',
    'pg_database_owner',
  ]) {
    identityRefused(
      runtimeFacts({ ownership: ownership({ memberOf: [role] }) }),
      migratorFacts(),
      /runtime role is a member of other roles/,
    );
  }
});

test('F6. unintended TRUNCATE, DELETE, REFERENCES, TRIGGER, MAINTAIN, audit-modify and DDL rights are refused', () => {
  identityRefused(
    runtimeFacts({ privileges: { ...cleanPrivileges, forbiddenTablePrivileges: 1 } }),
    migratorFacts(),
    /TRUNCATE, DELETE, REFERENCES, TRIGGER or MAINTAIN/,
  );
  identityRefused(
    runtimeFacts({ privileges: { ...cleanPrivileges, canModifyAuditEvents: true } }),
    migratorFacts(),
    /UPDATE or DELETE on audit_events/,
  );
  identityRefused(
    runtimeFacts({ privileges: { ...cleanPrivileges, canCreateInSchemaPublic: true } }),
    migratorFacts(),
    /create objects in schema public/,
  );
  identityRefused(
    runtimeFacts({ privileges: { ...cleanPrivileges, canCreateInDatabase: true } }),
    migratorFacts(),
    /create objects in the database/,
  );
});

test('19. a migrator superuser (or any elevated migrator attribute, including REPLICATION) is refused', () => {
  for (const [attribute, pattern] of [
    ['superuser', /migrator role is a superuser/],
    ['createdb', /migrator role has CREATEDB/],
    ['createrole', /migrator role has CREATEROLE/],
    ['bypassrls', /migrator role has BYPASSRLS/],
    ['replication', /migrator role has REPLICATION/],
  ] as const) {
    identityRefused(
      runtimeFacts(),
      migratorFacts({ role: { ...plainRole, [attribute]: true } }),
      pattern,
    );
  }
});

test('F6. the migrator must own the database and must have no unexpected memberships', () => {
  identityRefused(
    runtimeFacts(),
    migratorFacts({
      ownership: ownership({ ownsDatabase: false, ownedTables: [...FULL_APPLICATION_TABLES] }),
    }),
    /migrator role does not own the database/,
  );
  for (const role of ['pg_read_all_data', 'pg_write_all_data', 'pg_maintain', 'nook_it_runtime']) {
    identityRefused(
      runtimeFacts(),
      migratorFacts({
        ownership: ownership({
          ownsDatabase: true,
          ownedTables: [...FULL_APPLICATION_TABLES],
          memberOf: ['pg_database_owner', role],
        }),
      }),
      /migrator role has unexpected role memberships/,
    );
  }
});

test('F6. the migrator must own every application table, the expected ones must exist, and there must be tables', () => {
  identityRefused(
    runtimeFacts(),
    migratorFacts({
      ownership: ownership({
        ownsDatabase: true,
        ownedTables: FULL_APPLICATION_TABLES.slice(1),
      }),
    }),
    /does not own every application table/,
  );
  identityRefused(
    runtimeFacts(),
    migratorFacts({
      ownership: ownership({
        ownsDatabase: true,
        applicationTables: [],
        ownedTables: [],
      }),
    }),
    /no application tables/,
  );
  identityRefused(
    runtimeFacts(),
    migratorFacts({
      ownership: ownership({
        ownsDatabase: true,
        applicationTables: FULL_APPLICATION_TABLES.filter((t) => t !== 'bookings'),
        ownedTables: FULL_APPLICATION_TABLES.filter((t) => t !== 'bookings'),
      }),
    }),
    /missing expected application tables for the full profile/,
  );
});

test('profiles: the full profile refuses an initial-only database, and the initial profile refuses the full one', () => {
  const initialOnly = ownership({
    ownsDatabase: true,
    applicationTables: [...INITIAL_MIGRATION_TABLES],
    ownedTables: [...INITIAL_MIGRATION_TABLES],
  });
  identityRefused(runtimeFacts(), migratorFacts({ ownership: initialOnly }), /missing expected/);
  // the migration test's database: exactly the first migration's nine tables
  assert.doesNotThrow(() =>
    verifyIdentity(
      initialConfig,
      runtimeFacts({ ownership: ownership({ applicationTables: [...INITIAL_MIGRATION_TABLES] }) }),
      migratorFacts({ ownership: initialOnly }),
      cleanServer,
    ),
  );
  identityRefused(
    runtimeFacts(),
    migratorFacts(),
    /beyond the initial migration/,
    cleanServer,
    initialConfig,
  );
});

test('F5. a server that hosts nook_dev or nook_test is refused, even if no role can connect to it', () => {
  identityRefused(runtimeFacts(), migratorFacts(), /protected Nook database/, {
    protectedDatabases: ['nook_dev'],
  });
  identityRefused(runtimeFacts(), migratorFacts(), /protected Nook database/, {
    protectedDatabases: ['nook_dev', 'nook_test'],
  });
  // and the runtime role having no CONNECT right on it changes nothing
  identityRefused(
    runtimeFacts({ connectableOtherDatabases: [] }),
    migratorFacts(),
    /not a disposable server/,
    { protectedDatabases: ['nook_test'] },
  );
});

test('20. any database or server identity mismatch is refused', () => {
  identityRefused(
    runtimeFacts({ session: session({ database: 'nook_integration_other' }) }),
    migratorFacts(),
    /different database/,
  );
  identityRefused(
    runtimeFacts({ session: session({ database: 'nook_dev' }) }),
    migratorFacts({
      session: session({
        database: 'nook_dev',
        currentUser: 'nook_it_migrator',
        sessionUser: 'nook_it_migrator',
      }),
    }),
    /not an integration database/,
  );
  identityRefused(
    runtimeFacts({ session: session({ currentUser: 'someone_else' }) }),
    migratorFacts(),
    /different role/,
  );
  identityRefused(
    runtimeFacts({ session: session({ sessionUser: 'someone_else' }) }),
    migratorFacts(),
    /switched roles/,
  );
  identityRefused(
    runtimeFacts({ session: session({ serverAddr: '172.17.0.9' }) }),
    migratorFacts(),
    /server addresses/,
  );
  identityRefused(
    runtimeFacts({ session: session({ postmasterStart: 'other' }) }),
    migratorFacts(),
    /server instances/,
  );
  identityRefused(
    runtimeFacts({ session: session({ systemIdentifier: '1' }) }),
    migratorFacts(),
    /system identifiers/,
  );
  identityRefused(
    runtimeFacts({ session: session({ inRecovery: true }) }),
    migratorFacts(),
    /recovery/,
  );
  identityRefused(
    runtimeFacts(),
    migratorFacts({ session: session() }),
    /roles are the same|different role/,
  );
});

test('every violation is reported together, so one run shows everything wrong', () => {
  assert.throws(
    () =>
      verifyIdentity(
        config,
        runtimeFacts({
          role: { ...plainRole, superuser: true },
          privileges: { ...cleanPrivileges, canTruncateAuditEvents: true },
        }),
        migratorFacts({ role: { ...plainRole, createrole: true } }),
        { protectedDatabases: ['nook_dev'] },
      ),
    (error) =>
      error instanceof IntegrationGuardError &&
      error.reasons.length >= 4 &&
      /superuser/.test(error.message) &&
      /TRUNCATE/.test(error.message) &&
      /CREATEROLE/.test(error.message) &&
      /protected Nook database/.test(error.message),
  );
});

test('fault-injection objects must carry a per-run, test-owned name', () => {
  assert.doesNotThrow(() => assertTestOwnedObjectName('fin_test_fail_0123456789'));
  for (const bad of [
    'audit_events',
    'fin_test_fail',
    'fin_test_fail_XYZ',
    'drop_me',
    'fin_test_fail_0123456789; DROP TABLE x',
  ]) {
    assert.throws(() => assertTestOwnedObjectName(bad), IntegrationGuardError);
  }
});
