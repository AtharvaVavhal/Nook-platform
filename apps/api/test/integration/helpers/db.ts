import { Client } from 'pg';
import { assertTestOwnedObjectName } from './guard.js';
import { requireMigratorDatabaseUrl, requireTestDatabaseUrl } from './env.js';
import { assertSuiteLockHeld, ensureIsolatedDatabase } from './isolation.js';

// Fail closed at import: both URLs must pass the strict guard before this module is usable.
requireTestDatabaseUrl();
requireMigratorDatabaseUrl();

/** Fault-injection triggers and functions must carry a per-run, test-only name before they are created or dropped. */
export { assertTestOwnedObjectName as assertFaultInjectionName };

/**
 * Every client handed out first proves the database was verified in this process and that the suite lock is
 * still held. If the lock was lost the process has already been ended; this is the second line of defence.
 */
function requireVerified(): void {
  assertSuiteLockHeld();
}

// The synchronous factories exist for tests that manage a connection themselves (for example to hold a
// row lock). They refuse to hand out a client until the identity checks and the suite lock have succeeded.
export function createMigratorClient(): Client {
  requireVerified();
  const client = new Client({ connectionString: requireMigratorDatabaseUrl() });
  // @ts-expect-error - pg Client emit 'connect' event but types don't include it
  client.on('connect', () => client.query('SET timezone = UTC'));
  return client;
}

export function createRuntimeClient(): Client {
  requireVerified();
  const client = new Client({ connectionString: requireTestDatabaseUrl() });
  // @ts-expect-error - pg Client emit 'connect' event but types don't include it
  client.on('connect', () => client.query('SET timezone = UTC'));
  return client;
}

export async function withMigratorClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  await ensureIsolatedDatabase();
  const client = createMigratorClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function withRuntimeClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  await ensureIsolatedDatabase();
  const client = createRuntimeClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function provisionTestOrgUserMembership(
  orgId: string,
  userId: string,
  membershipId: string,
  email: string,
  passwordHash: string,
  orgName: string,
  displayName: string,
): Promise<void> {
  await withMigratorClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO organizations (id, name, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
        [orgId, orgName],
      );
      await client.query(
        `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [userId, email, passwordHash, displayName],
      );
      await client.query(
        `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1, $2, $3, 'OWNER', 'ACTIVE')`,
        [membershipId, orgId, userId],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
}

export async function verifyProvisioned(
  orgId: string,
  userId: string,
  membershipId: string,
): Promise<{ org: boolean; user: boolean; membership: boolean }> {
  return withRuntimeClient(async (client) => {
    const org = await client.query(`SELECT 1 FROM organizations WHERE id = $1`, [orgId]);
    const user = await client.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    const membership = await client.query(`SELECT 1 FROM memberships WHERE id = $1`, [
      membershipId,
    ]);
    return {
      org: org.rowCount === 1,
      user: user.rowCount === 1,
      membership: membership.rowCount === 1,
    };
  });
}
