/**
 * Fail-closed safety guard for the integration suite. Everything in this file is a pure function of its
 * inputs: it never connects to PostgreSQL, reads no environment at import time, and never puts a URL, a
 * password or a user name into a message. The impure half (running the identity queries and holding the
 * suite lock) lives in `isolation.ts` and feeds the facts it collects into `verifyIdentity` here.
 *
 * The suite writes fixtures with the migrator role and has no teardown, so it may only ever run against a
 * dedicated, disposable database. Every rule below exists to make pointing it anywhere else impossible.
 */

/** Must be exactly `1`. Proves a human chose to run the suite against a disposable database. */
export const OPT_IN_VARIABLE = 'NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB';

/** Selects which table set the database must contain. Absent means `full`. */
export const PROFILE_VARIABLE = 'NOOK_INTEGRATION_PROFILE';

/** The comment the disposable database must carry (`COMMENT ON DATABASE`), set during provisioning. */
export const DATABASE_MARKER =
  'nook-integration-isolated: disposable, booking concurrency verification';

/** The only database names the suite will touch. */
export const DATABASE_NAME_PATTERN = /^nook_integration_[a-z0-9_]+$/;

/** Named explicitly so the refusal is unmistakable even if the pattern above is ever loosened. */
export const FORBIDDEN_DATABASES: readonly string[] = ['nook_dev', 'nook_test'];

/** 5432 may be an unrelated PostgreSQL; 5433 is the project's development server. */
export const FORBIDDEN_PORTS: readonly number[] = [5432, 5433];

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]'];

/** The only query parameter a URL may carry (Prisma-style); anything else could redirect or change TLS. */
const ALLOWED_QUERY: Readonly<Record<string, string>> = { schema: 'public' };

/**
 * Environment variables that node-postgres or libpq-style tooling read and that can silently change a
 * connection (host, port, database, user, TLS, session options). Any variable starting with `PG` is refused,
 * because the driver falls back to them for every field a URL does not set. The list below names the ones
 * reviewed by hand; the prefix rule also catches the rest. There are deliberately no exceptions.
 */
export const REVIEWED_PG_VARIABLES: readonly string[] = [
  'PGHOST',
  'PGHOSTADDR',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGPASSFILE',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGSSLMODE',
  'PGSSLCERT',
  'PGSSLKEY',
  'PGSSLROOTCERT',
  'PGSSLCRL',
  'PGSSLSNI',
  'PGREQUIRESSL',
  'PGOPTIONS',
  'PGAPPNAME',
  'PGCONNECT_TIMEOUT',
  'PGCLIENTENCODING',
  'PGTARGETSESSIONATTRS',
  'PGSYSCONFDIR',
  'PGTZ',
  'PGDATESTYLE',
];

/** Non-`PG` variables that change how the driver's TLS behaves. */
export const OTHER_DRIVER_VARIABLES: readonly string[] = ['NODE_TLS_REJECT_UNAUTHORIZED'];

export class IntegrationGuardError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super(
      `Integration-test safety guard refused to start:\n${reasons.map((r) => `  - ${r}`).join('\n')}`,
    );
    this.name = 'IntegrationGuardError';
    this.reasons = reasons;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

// ------------------------------------------------------------------ connection metadata (no secrets)

/**
 * Sanitized connection metadata. It carries no password and no URL, so printing, serializing or diffing it
 * cannot leak a credential. The password-bearing connection string lives in a module-private map and is
 * reachable only through `connectionStringOf`, which the database helpers call and nothing else should.
 */
export interface GuardedUrl {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
}

const CONNECTION_STRINGS = new WeakMap<object, string>();

function makeGuarded(meta: GuardedUrl, connectionString: string): GuardedUrl {
  const guarded = Object.freeze({ ...meta });
  CONNECTION_STRINGS.set(guarded, connectionString);
  return guarded;
}

/** The connection string for the database driver only. Never log, print or serialize the result. */
export function connectionStringOf(target: GuardedUrl): string {
  const value = CONNECTION_STRINGS.get(target);
  if (value === undefined) {
    throw new IntegrationGuardError(['connection details are not available for this object']);
  }
  return value;
}

interface Inspection {
  value?: GuardedUrl;
  reasons: string[];
}

/** Strictly parses one connection URL. Reasons name the variable and the rule, never the value. */
function inspectUrl(raw: string | undefined, label: string): Inspection {
  if (raw === undefined || raw.trim() === '') return { reasons: [`${label} is not set`] };
  if (raw !== raw.trim()) return { reasons: [`${label} must not have surrounding whitespace`] };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reasons: [`${label} is not a valid URL`] };
  }

  const reasons: string[] = [];
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    reasons.push(`${label} must use the postgres:// or postgresql:// scheme`);
  }
  if (url.hash !== '') reasons.push(`${label} must not have a fragment`);

  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) reasons.push(`${label} repeats a query parameter`);
    seen.add(key);
    if (ALLOWED_QUERY[key] !== value) {
      reasons.push(`${label} has a query parameter that is not allowed (only schema=public is)`);
    }
  }
  if (raw.includes('?') && seen.size === 0) reasons.push(`${label} has an empty query string`);

  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.includes(host)) {
    reasons.push(`${label} must point at a loopback host (127.0.0.1, localhost or [::1])`);
  }

  let port = 0;
  if (url.port === '') {
    reasons.push(`${label} must give an explicit port`);
  } else {
    port = Number(url.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
      reasons.push(`${label} has an invalid port`);
    } else if (FORBIDDEN_PORTS.includes(port)) {
      reasons.push(`${label} uses a forbidden port (5432 and 5433 are never allowed)`);
    }
  }

  let username = '';
  try {
    username = decodeURIComponent(url.username);
  } catch {
    reasons.push(`${label} has a malformed user name`);
  }
  if (username === '' && !reasons.some((r) => r.includes('malformed user name'))) {
    reasons.push(`${label} must name a user`);
  }

  let database = '';
  if (!/^\/[^/]+$/.test(url.pathname)) {
    reasons.push(`${label} must name exactly one database`);
  } else {
    database = url.pathname.slice(1);
    if (FORBIDDEN_DATABASES.includes(database)) {
      reasons.push(`${label} names a protected database`);
    } else if (!DATABASE_NAME_PATTERN.test(database)) {
      reasons.push(`${label} must name a database matching nook_integration_*`);
    }
  }

  if (reasons.length > 0) return { reasons };
  return { value: makeGuarded({ host, port, database, username }, raw), reasons };
}

// ------------------------------------------------------------------ ambient driver environment

/** Names (never values) of every set variable that could override the connection. Sorted. */
export function ambientDriverVariables(env: Env): string[] {
  return Object.keys(env)
    .filter((name) => env[name] !== undefined)
    .filter((name) => /^PG[A-Z0-9_]*$/.test(name) || OTHER_DRIVER_VARIABLES.includes(name))
    .sort();
}

// ------------------------------------------------------------------ profiles

export type IntegrationProfile = 'full' | 'initial-migration';

/** Every application table the full migration history creates. */
export const FULL_APPLICATION_TABLES: readonly string[] = [
  'admissions',
  'audit_events',
  'beds',
  'bookings',
  'check_ins',
  'check_outs',
  'correction_command_receipts',
  'correction_finance_links',
  'correction_proposals',
  'enquiries',
  'enquiry_follow_ups',
  'floors',
  'invoice_adjustments',
  'invoice_voids',
  'invoices',
  'login_throttles',
  'memberships',
  'organizations',
  'payment_idempotency_keys',
  'payment_reversals',
  'payments',
  'properties',
  'residents',
  'rooms',
  'sessions',
  'stay_assignments',
  'stay_assignment_replacements',
  'transfer_command_receipts',
  'transfer_finance_reviews',
  'transfer_finance_resolutions',
  'transfers',
  'users',
];

/** The nine tables the first migration creates; the database-migration test asserts exactly these. */
export const INITIAL_MIGRATION_TABLES: readonly string[] = [
  'audit_events',
  'beds',
  'floors',
  'memberships',
  'organizations',
  'properties',
  'rooms',
  'sessions',
  'users',
];

/** The only role memberships the migrator may have: PostgreSQL's implicit database-owner role. */
export const ALLOWED_MIGRATOR_MEMBERSHIPS: readonly string[] = ['pg_database_owner'];

function parseProfile(env: Env, reasons: string[]): IntegrationProfile {
  const raw = env[PROFILE_VARIABLE];
  if (raw === undefined || raw === 'full') return 'full';
  if (raw === 'initial-migration') return 'initial-migration';
  reasons.push(`${PROFILE_VARIABLE} must be unset, "full" or "initial-migration"`);
  return 'full';
}

// ------------------------------------------------------------------ environment

export interface IntegrationConfig {
  readonly runtime: GuardedUrl;
  readonly migrator: GuardedUrl;
  readonly profile: IntegrationProfile;
}

/**
 * Validates the whole environment: the explicit opt-in, the owner-password variable, the profile, the absence
 * of any ambient driver variable, and both URLs independently and against each other. Throws one
 * IntegrationGuardError listing every violation.
 */
export function validateEnvironment(env: Env): IntegrationConfig {
  const reasons: string[] = [];
  if (env[OPT_IN_VARIABLE] !== '1') {
    reasons.push(`${OPT_IN_VARIABLE}=1 is required (explicit opt-in to a disposable database)`);
  }
  if (!env.TEST_OWNER_PASSWORD) reasons.push('TEST_OWNER_PASSWORD is not set');
  const profile = parseProfile(env, reasons);

  for (const name of ambientDriverVariables(env)) {
    reasons.push(`the environment variable ${name} is set and could override the connection`);
  }

  const runtime = inspectUrl(env.DATABASE_URL, 'DATABASE_URL');
  const migrator = inspectUrl(env.MIGRATOR_DATABASE_URL, 'MIGRATOR_DATABASE_URL');
  reasons.push(...runtime.reasons, ...migrator.reasons);

  if (runtime.value && migrator.value) {
    if (runtime.value.host !== migrator.value.host) {
      reasons.push('DATABASE_URL and MIGRATOR_DATABASE_URL point at different hosts');
    }
    if (runtime.value.port !== migrator.value.port) {
      reasons.push('DATABASE_URL and MIGRATOR_DATABASE_URL point at different ports');
    }
    if (runtime.value.database !== migrator.value.database) {
      reasons.push('DATABASE_URL and MIGRATOR_DATABASE_URL name different databases');
    }
    if (runtime.value.username === migrator.value.username) {
      reasons.push('DATABASE_URL and MIGRATOR_DATABASE_URL must use different roles');
    }
  }

  if (reasons.length > 0 || !runtime.value || !migrator.value) {
    throw new IntegrationGuardError(reasons);
  }
  return { runtime: runtime.value, migrator: migrator.value, profile };
}

/** A driver error reduced to a SQLSTATE or Node errno code, or `unknown`. Never the message, which can carry details. */
export function sanitizeDriverError(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && (/^[0-9A-Z]{5}$/.test(code) || /^E[A-Z0-9_]{2,}$/.test(code))) {
    return code;
  }
  return 'unknown';
}

// ------------------------------------------------------------------ identity, from facts gathered by queries

export interface SessionFacts {
  database: string;
  currentUser: string;
  sessionUser: string;
  serverAddr: string | null;
  serverPort: number;
  inRecovery: boolean;
  postmasterStart: string;
  /** `pg_control_system().system_identifier`, or null where the role may not read it. */
  systemIdentifier: string | null;
  /** The database comment; must equal DATABASE_MARKER. */
  marker: string | null;
}

export interface RoleFacts {
  superuser: boolean;
  createdb: boolean;
  createrole: boolean;
  bypassrls: boolean;
  replication: boolean;
}

export interface OwnershipFacts {
  /** Whether the connected role owns the database. */
  ownsDatabase: boolean;
  /** Non-system schemas in this database owned by the role. */
  ownedSchemas: number;
  /** Non-system functions owned by the role. */
  ownedFunctions: number;
  /** Application tables (schema public, Prisma ledger excluded). */
  applicationTables: readonly string[];
  /** The subset of them the role owns. */
  ownedTables: readonly string[];
  /** Every role the connected role is a member of, directly or indirectly. */
  memberOf: readonly string[];
}

/** What the runtime role can do, inspected with has_*_privilege and never exercised. */
export interface RuntimePrivilegeFacts {
  /** Count of (table, privilege) grants among TRUNCATE, DELETE, REFERENCES, TRIGGER and MAINTAIN on any public table. */
  forbiddenTablePrivileges: number;
  canModifyAuditEvents: boolean;
  canTruncateAuditEvents: boolean;
  canCreateInSchemaPublic: boolean;
  canCreateInDatabase: boolean;
}

export interface RuntimeFacts {
  session: SessionFacts;
  role: RoleFacts;
  ownership: OwnershipFacts;
  privileges: RuntimePrivilegeFacts;
  /** Other databases on the server the role may CONNECT to. */
  connectableOtherDatabases: readonly string[];
}

export interface MigratorFacts {
  session: SessionFacts;
  role: RoleFacts;
  ownership: OwnershipFacts;
}

/** Facts about the server as a whole, from the read-only catalog. */
export interface ServerFacts {
  /** Which of FORBIDDEN_DATABASES exist on this server, whether or not anyone can connect to them. */
  protectedDatabases: readonly string[];
}

function roleViolations(label: string, role: RoleFacts): string[] {
  const out: string[] = [];
  if (role.superuser) out.push(`the ${label} role is a superuser`);
  if (role.createdb) out.push(`the ${label} role has CREATEDB`);
  if (role.createrole) out.push(`the ${label} role has CREATEROLE`);
  if (role.bypassrls) out.push(`the ${label} role has BYPASSRLS`);
  if (role.replication) out.push(`the ${label} role has REPLICATION`);
  return out;
}

function sessionViolations(label: string, session: SessionFacts, expected: GuardedUrl): string[] {
  const out: string[] = [];
  if (session.database !== expected.database) {
    out.push(`the ${label} connection reached a different database than its URL names`);
  }
  if (
    !DATABASE_NAME_PATTERN.test(session.database) ||
    FORBIDDEN_DATABASES.includes(session.database)
  ) {
    out.push(`the ${label} connection is on a database that is not an integration database`);
  }
  if (session.currentUser !== expected.username) {
    out.push(`the ${label} connection is running as a different role than its URL names`);
  }
  if (session.sessionUser !== session.currentUser) {
    out.push(`the ${label} connection has switched roles (session_user differs from current_user)`);
  }
  if (session.inRecovery)
    out.push(`the ${label} connection is on a server in recovery (a replica)`);
  if (session.marker !== DATABASE_MARKER) {
    out.push(`the database marker is missing or wrong on the ${label} connection`);
  }
  return out;
}

function missingFrom(expected: readonly string[], actual: readonly string[]): string[] {
  return expected.filter((name) => !actual.includes(name));
}

function runtimeViolations(runtime: RuntimeFacts): string[] {
  const out = roleViolations('runtime', runtime.role);
  const o = runtime.ownership;
  if (o.ownsDatabase) out.push('the runtime role owns the database');
  if (o.ownedTables.length > 0) out.push('the runtime role owns application tables');
  if (o.ownedSchemas > 0) out.push('the runtime role owns a schema');
  if (o.ownedFunctions > 0) out.push('the runtime role owns functions');
  if (o.memberOf.length > 0) {
    out.push(
      'the runtime role is a member of other roles (including any predefined privileged role)',
    );
  }
  const p = runtime.privileges;
  if (p.forbiddenTablePrivileges > 0) {
    out.push(
      'the runtime role has TRUNCATE, DELETE, REFERENCES, TRIGGER or MAINTAIN on application tables',
    );
  }
  if (p.canTruncateAuditEvents) out.push('the runtime role has TRUNCATE on audit_events');
  if (p.canModifyAuditEvents) out.push('the runtime role has UPDATE or DELETE on audit_events');
  if (p.canCreateInSchemaPublic) out.push('the runtime role can create objects in schema public');
  if (p.canCreateInDatabase) out.push('the runtime role can create objects in the database');
  if (runtime.connectableOtherDatabases.length > 0) {
    out.push('the runtime role can connect to other databases on the server');
  }
  return out;
}

function migratorViolations(migrator: MigratorFacts, profile: IntegrationProfile): string[] {
  const out = roleViolations('migrator', migrator.role);
  const o = migrator.ownership;
  if (!o.ownsDatabase) out.push('the migrator role does not own the database');
  const unexpected = o.memberOf.filter((r) => !ALLOWED_MIGRATOR_MEMBERSHIPS.includes(r));
  if (unexpected.length > 0) out.push('the migrator role has unexpected role memberships');

  const expected = profile === 'full' ? FULL_APPLICATION_TABLES : INITIAL_MIGRATION_TABLES;
  if (o.applicationTables.length === 0) {
    out.push('the database has no application tables (migrations have not been applied)');
  } else {
    if (missingFrom(expected, o.applicationTables).length > 0) {
      out.push(`the database is missing expected application tables for the ${profile} profile`);
    }
    if (profile === 'initial-migration' && missingFrom(o.applicationTables, expected).length > 0) {
      out.push(
        'the database has tables beyond the initial migration (wrong database for this profile)',
      );
    }
    if (missingFrom(o.applicationTables, o.ownedTables).length > 0) {
      out.push('the migrator role does not own every application table');
    }
  }
  return out;
}

/**
 * Compares what both connections report about themselves with what the URLs promised, with the required
 * privilege model and with the server as a whole. Throws one IntegrationGuardError listing every violation;
 * nothing may write a fixture until this has returned.
 */
export function verifyIdentity(
  config: IntegrationConfig,
  runtime: RuntimeFacts,
  migrator: MigratorFacts,
  server: ServerFacts,
): void {
  const reasons: string[] = [
    ...sessionViolations('runtime', runtime.session, config.runtime),
    ...sessionViolations('migrator', migrator.session, config.migrator),
  ];

  const r = runtime.session;
  const m = migrator.session;
  if (r.database !== m.database) reasons.push('the two connections are on different databases');
  if (r.serverAddr !== m.serverAddr || r.serverPort !== m.serverPort) {
    reasons.push('the two connections report different server addresses');
  }
  if (r.postmasterStart !== m.postmasterStart) {
    reasons.push('the two connections are on different server instances');
  }
  if (r.systemIdentifier !== m.systemIdentifier) {
    reasons.push('the two connections report different server system identifiers');
  }
  if (r.currentUser === m.currentUser) reasons.push('the runtime and migrator roles are the same');

  if (server.protectedDatabases.length > 0) {
    reasons.push(
      'this server hosts a protected Nook database (nook_dev or nook_test); it is not a disposable server',
    );
  }

  reasons.push(...runtimeViolations(runtime), ...migratorViolations(migrator, config.profile));

  if (reasons.length > 0) throw new IntegrationGuardError(reasons);
}

/** Fault-injection triggers and functions the suite creates must carry a test-only, per-run name. */
const TEST_OWNED_OBJECT = /^fin_test_[a-z]+_[0-9a-f]{10}$/;

export function assertTestOwnedObjectName(name: string): void {
  if (!TEST_OWNED_OBJECT.test(name)) {
    throw new IntegrationGuardError([
      'refusing to create or drop an object without a test-owned name',
    ]);
  }
}
