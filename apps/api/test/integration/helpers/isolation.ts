import { Client } from 'pg';
import {
  FORBIDDEN_DATABASES,
  IntegrationGuardError,
  connectionStringOf,
  sanitizeDriverError,
  validateEnvironment,
  verifyIdentity,
  type IntegrationConfig,
  type MigratorFacts,
  type OwnershipFacts,
  type RoleFacts,
  type RuntimeFacts,
  type RuntimePrivilegeFacts,
  type ServerFacts,
  type SessionFacts,
} from './guard.js';
import { SuiteLock, type LockClock, type LockConnection } from './suite-lock.js';

/**
 * The impure half of the guard. It runs read-only identity and privilege queries on both connections,
 * hands the facts to the pure `verifyIdentity`, and then holds a session-level advisory lock for the life
 * of the process (see suite-lock.ts for the lifecycle). Nothing here writes a row, and nothing here is run
 * by the unit tests (they feed the pure functions mock facts and a mock connection).
 *
 * Every query below reads a catalog that any role may read; none needs a privilege to be granted.
 */

/** One fixed key for the whole suite; advisory locks are per database, so this is per disposable database. */
const SUITE_LOCK_SQL = `SELECT pg_try_advisory_lock(hashtextextended('nook:integration-suite', 0)) AS locked`;

const SESSION_SQL = `
  SELECT current_database() AS database,
         current_user AS current_user,
         session_user AS session_user,
         inet_server_addr()::text AS server_addr,
         inet_server_port() AS server_port,
         pg_is_in_recovery() AS in_recovery,
         pg_postmaster_start_time()::text AS postmaster_start,
         shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS marker`;

const ROLE_SQL = `
  SELECT rolsuper AS superuser, rolcreatedb AS createdb, rolcreaterole AS createrole,
         rolbypassrls AS bypassrls, rolreplication AS replication
  FROM pg_roles WHERE rolname = current_user`;

// Database, schema and function ownership of the connected role. System schemas and functions are excluded.
const OWNERSHIP_SQL = `
  SELECT
    (SELECT datdba = r.oid FROM pg_database WHERE datname = current_database()) AS owns_database,
    (SELECT count(*)::int FROM pg_namespace WHERE nspowner = r.oid AND nspname !~ '^pg_') AS owned_schemas,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.proowner = r.oid AND n.nspname NOT IN ('pg_catalog', 'information_schema')) AS owned_functions
  FROM pg_roles r WHERE r.rolname = current_user`;

// The Prisma ledger is excluded: it is an infrastructure table, not application data.
const TABLES_SQL = `
  SELECT c.relname AS name, (c.relowner = r.oid) AS owned
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN pg_roles r
  WHERE r.rolname = current_user AND n.nspname = 'public'
    AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'
  ORDER BY 1`;

// Every role the connected role is a member of, directly or indirectly (pg_has_role 'MEMBER' ignores NOINHERIT).
const MEMBERSHIP_SQL = `
  SELECT r.rolname AS name FROM pg_roles r
  WHERE r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER')
  ORDER BY 1`;

// Privilege inspections, never attempts: nothing is truncated, deleted or created to find out whether it could be.
// MAINTAIN exists from PostgreSQL 17, which is the pinned server version; an older server fails closed here.
const PRIVILEGES_SQL = `
  SELECT
    (SELECT count(*)::int
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest(ARRAY['TRUNCATE', 'DELETE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) AS p(priv)
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         AND has_table_privilege(current_user, c.oid, p.priv)) AS forbidden_table_privileges,
    (has_table_privilege(current_user, 'public.audit_events', 'UPDATE')
       OR has_table_privilege(current_user, 'public.audit_events', 'DELETE')) AS can_modify_audit,
    has_table_privilege(current_user, 'public.audit_events', 'TRUNCATE') AS can_truncate_audit,
    has_schema_privilege(current_user, 'public', 'CREATE') AS create_in_public,
    has_database_privilege(current_user, current_database(), 'CREATE') AS create_in_database`;

const OTHER_DATABASES_SQL = `
  SELECT datname FROM pg_database
  WHERE datallowconn AND NOT datistemplate AND datname <> current_database()
    AND has_database_privilege(current_user, oid, 'CONNECT')
  ORDER BY 1`;

// Which protected databases exist on this server at all, whether or not the role can connect to them.
const PROTECTED_DATABASES_SQL = `
  SELECT datname FROM pg_database WHERE datname = ANY($1::text[]) ORDER BY 1`;

async function sessionFacts(client: Client): Promise<SessionFacts> {
  const row = (await client.query(SESSION_SQL)).rows[0];
  let systemIdentifier: string | null = null;
  try {
    // Where safely available: some roles may not read the control file. Both sides are compared as-is.
    systemIdentifier = (
      await client.query(`SELECT system_identifier::text AS id FROM pg_control_system()`)
    ).rows[0].id;
  } catch {
    systemIdentifier = null;
  }
  return {
    database: row.database,
    currentUser: row.current_user,
    sessionUser: row.session_user,
    serverAddr: row.server_addr,
    serverPort: Number(row.server_port),
    inRecovery: Boolean(row.in_recovery),
    postmasterStart: row.postmaster_start,
    systemIdentifier,
    marker: row.marker,
  };
}

async function roleFacts(client: Client): Promise<RoleFacts> {
  const row = (await client.query(ROLE_SQL)).rows[0];
  if (!row) throw new IntegrationGuardError(['the connected role is not in pg_roles']);
  return {
    superuser: Boolean(row.superuser),
    createdb: Boolean(row.createdb),
    createrole: Boolean(row.createrole),
    bypassrls: Boolean(row.bypassrls),
    replication: Boolean(row.replication),
  };
}

async function ownershipFacts(client: Client): Promise<OwnershipFacts> {
  const owner = (await client.query(OWNERSHIP_SQL)).rows[0];
  if (!owner) throw new IntegrationGuardError(['the connected role is not in pg_roles']);
  const tables = (await client.query(TABLES_SQL)).rows as { name: string; owned: boolean }[];
  const memberships = (await client.query(MEMBERSHIP_SQL)).rows as { name: string }[];
  return {
    ownsDatabase: Boolean(owner.owns_database),
    ownedSchemas: Number(owner.owned_schemas),
    ownedFunctions: Number(owner.owned_functions),
    applicationTables: tables.map((t) => t.name),
    ownedTables: tables.filter((t) => t.owned).map((t) => t.name),
    memberOf: memberships.map((m) => m.name),
  };
}

async function privilegeFacts(client: Client): Promise<RuntimePrivilegeFacts> {
  const row = (await client.query(PRIVILEGES_SQL)).rows[0];
  return {
    forbiddenTablePrivileges: Number(row.forbidden_table_privileges),
    canModifyAuditEvents: Boolean(row.can_modify_audit),
    canTruncateAuditEvents: Boolean(row.can_truncate_audit),
    canCreateInSchemaPublic: Boolean(row.create_in_public),
    canCreateInDatabase: Boolean(row.create_in_database),
  };
}

// ------------------------------------------------------------------ the suite lock, over a real connection

function lockConnection(client: Client): LockConnection {
  return {
    async tryAdvisoryLock() {
      return Boolean((await client.query(SUITE_LOCK_SQL)).rows[0].locked);
    },
    async ping() {
      await client.query('SELECT 1');
    },
    onLost(listener) {
      client.on('error', (error) => listener(`connection error (${sanitizeDriverError(error)})`));
      client.on('end', () => listener('connection closed'));
    },
    async close() {
      await client.end();
    },
  };
}

const realClock: LockClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  every(fn, ms) {
    const handle = setInterval(fn, ms);
    handle.unref(); // the heartbeat must never keep a finished test process alive
    return { stop: () => clearInterval(handle) };
  },
};

/** The lock was lost while tests were running. Nothing may continue without it, so the process ends. */
function abortBecauseLockLost(reason: string): void {
  process.stderr.write(
    `\n[integration guard] the suite lock was lost (${reason}); aborting the test process\n`,
  );
  process.exit(1);
}

let suiteLock: SuiteLock | undefined;
let hooksInstalled = false;

/** Releases the lock on normal shutdown and on SIGINT/SIGTERM. Closing the connection is what releases it. */
function installShutdownHooks(lock: SuiteLock): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.once('beforeExit', () => {
    void lock.release();
  });
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    process.once(signal, () => {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      void Promise.race([lock.release(), timeout]).finally(() => process.exit(code));
    });
  }
}

// ------------------------------------------------------------------ verification

export interface VerifiedIntegrationDatabase {
  config: IntegrationConfig;
}

let verification: Promise<VerifiedIntegrationDatabase> | undefined;

async function closeQuietly(client: Client | undefined): Promise<void> {
  try {
    await client?.end();
  } catch {
    /* already closed */
  }
}

async function runChecks(env: NodeJS.ProcessEnv): Promise<VerifiedIntegrationDatabase> {
  // 1. Strict environment and URL validation. No connection is made until this passes.
  const config = validateEnvironment(env);

  const runtime = new Client({ connectionString: connectionStringOf(config.runtime) });
  // The migrator connection also becomes the lock holder, so it asks the OS to detect a dead peer.
  const migrator = new Client({
    connectionString: connectionStringOf(config.migrator),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  runtime.on('error', () => undefined);
  migrator.on('error', () => undefined);
  try {
    await Promise.all([runtime.connect(), migrator.connect()]);

    // 2. Read-only identity, ownership and privilege facts.
    const runtimeFacts: RuntimeFacts = {
      session: await sessionFacts(runtime),
      role: await roleFacts(runtime),
      ownership: await ownershipFacts(runtime),
      privileges: await privilegeFacts(runtime),
      connectableOtherDatabases: (await runtime.query(OTHER_DATABASES_SQL)).rows.map(
        (r) => r.datname,
      ),
    };
    const migratorFacts: MigratorFacts = {
      session: await sessionFacts(migrator),
      role: await roleFacts(migrator),
      ownership: await ownershipFacts(migrator),
    };
    const serverFacts: ServerFacts = {
      protectedDatabases: (
        await migrator.query(PROTECTED_DATABASES_SQL, [[...FORBIDDEN_DATABASES]])
      ).rows.map((r) => r.datname),
    };

    // 3. Pure comparison. Throws before anything can write.
    verifyIdentity(config, runtimeFacts, migratorFacts, serverFacts);

    // 4. One suite at a time per database. Retries use this same connection; on failure it is closed.
    const lock = new SuiteLock(lockConnection(migrator), realClock, abortBecauseLockLost);
    await lock.acquire();
    suiteLock = lock;
    // Do not let the idle lock connection keep the process alive; the beforeExit hook releases it.
    (
      migrator as unknown as { connection?: { stream?: { unref?: () => void } } }
    ).connection?.stream?.unref?.();
    installShutdownHooks(lock);
    await closeQuietly(runtime);
    return { config };
  } catch (error) {
    await closeQuietly(runtime);
    await closeQuietly(migrator);
    if (error instanceof IntegrationGuardError) throw error;
    // A driver error can carry connection details; report only its code.
    throw new IntegrationGuardError([
      `the database identity checks could not complete (${sanitizeDriverError(error)})`,
    ]);
  }
}

/**
 * Verifies the database once per process (memoized) and takes the suite lock. Every helper that can
 * write awaits this first, so a missing or failed check stops the run before any fixture exists.
 */
export function ensureIsolatedDatabase(
  env: NodeJS.ProcessEnv = process.env,
): Promise<VerifiedIntegrationDatabase> {
  verification ??= runChecks(env);
  return verification;
}

/** True only while the checks have succeeded in this process AND the suite lock is still held. */
export function isolationVerified(): boolean {
  return suiteLock?.state === 'held';
}

/** Throws unless the suite lock is still held. Called before every client is handed out. */
export function assertSuiteLockHeld(): void {
  if (!suiteLock) {
    throw new IntegrationGuardError(['the integration database has not been verified']);
  }
  suiteLock.assertHeld();
}
