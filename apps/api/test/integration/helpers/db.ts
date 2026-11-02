import { Client } from 'pg';
import { requireTestDatabaseUrl } from './env.js';

const migratorUrl = process.env.MIGRATOR_DATABASE_URL;
if (!migratorUrl) {
  throw new Error('MIGRATOR_DATABASE_URL environment variable is required');
}

export function createMigratorClient(): Client {
  return new Client({ connectionString: migratorUrl });
}

export function createRuntimeClient(): Client {
  return new Client({ connectionString: requireTestDatabaseUrl() });
}

export async function withMigratorClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = createMigratorClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function withRuntimeClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
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
  displayName: string
): Promise<void> {
  await withMigratorClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO organizations (id, name, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
        [orgId, orgName]
      );
      await client.query(
        `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [userId, email, passwordHash, displayName]
      );
      await client.query(
        `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1, $2, $3, 'OWNER', 'ACTIVE')`,
        [membershipId, orgId, userId]
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
  membershipId: string
): Promise<{ org: boolean; user: boolean; membership: boolean }> {
  return withRuntimeClient(async (client) => {
    const org = await client.query(`SELECT 1 FROM organizations WHERE id = $1`, [orgId]);
    const user = await client.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    const membership = await client.query(`SELECT 1 FROM memberships WHERE id = $1`, [membershipId]);
    return {
      org: org.rowCount === 1,
      user: user.rowCount === 1,
      membership: membership.rowCount === 1,
    };
  });
}