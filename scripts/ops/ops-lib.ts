// Shared helpers for the operator scripts (provision-user, reset-password, revoke-access).
// These are run by a person with the migrator credential, never exposed as an API.
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg') as typeof import('pg');

export type OpsClient = import('pg').Client;

const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // no look-alike characters
export const ROLES = ['OWNER', 'PROPERTY_MANAGER'] as const;

export function fail(message: string): never {
  console.error(`STOP: ${message}`);
  process.exit(2);
}

export function parseOpsArgs(options: Record<string, { type: 'string'; short?: string }>) {
  const { values } = parseArgs({
    options: { ...options, 'confirm-target': { type: 'string' }, 'env-file': { type: 'string' } },
    allowPositionals: false,
  });
  return values as Record<string, string | undefined>;
}

export function normalizeEmail(email: string | undefined): string {
  const value = (email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail('--email must be a valid e-mail address');
  return value;
}

/** A random temporary password. It is shown once on the operator's terminal and never stored or logged. */
export function randomTemporaryPassword(length = 20): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return out;
}

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Connects with MIGRATOR_DATABASE_URL (environment, or an env file; default .env.migrator). The operator
 * must repeat the target as host:port/database in --confirm-target, which guards against a wrong database.
 * Only the target is printed, never the credential.
 */
export async function connect(
  args: Record<string, string | undefined>,
): Promise<{ client: OpsClient; target: string }> {
  let url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) {
    const file = args['env-file'] ?? new URL('../../.env.migrator', import.meta.url).pathname;
    if (!existsSync(file)) fail(`MIGRATOR_DATABASE_URL is not set and ${file} does not exist`);
    url = readEnvFile(file).MIGRATOR_DATABASE_URL;
  }
  if (!url) fail('MIGRATOR_DATABASE_URL is empty');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail('MIGRATOR_DATABASE_URL is not a valid connection string');
  }
  const target = `${parsed.hostname}:${parsed.port || '5432'}/${parsed.pathname.slice(1)}`;
  if (!args['confirm-target'])
    fail(`--confirm-target is required. The configured target is ${target}`);
  if (args['confirm-target'] !== target)
    fail(`--confirm-target does not match the configured target ${target}`);
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  await client.connect();
  const who = (await client.query('select current_user u, current_database() d')).rows[0];
  console.error(`Target verified: ${target} as role ${who.u}`);
  return { client, target };
}

export async function audit(
  client: OpsClient,
  action: 'auth.user.provisioned' | 'auth.password.reset' | 'auth.access.revoked',
  entry: {
    organizationId: string | null;
    targetUserId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, action, target_type, target_id, request_id, metadata)
     VALUES ($1, NULL, $2, 'user', $3, $4, $5)`,
    [
      entry.organizationId,
      action,
      entry.targetUserId,
      randomUUID(),
      JSON.stringify({
        via: 'ops-script',
        operator: userInfo().username,
        ...(entry.metadata ?? {}),
      }),
    ],
  );
}

export function showOnce(email: string, password: string): void {
  console.log('');
  console.log('================================================================');
  console.log(` Temporary password for ${email}`);
  console.log('');
  console.log(`   ${password}`);
  console.log('');
  console.log(' Shown ONCE. It is not stored or logged anywhere. Hand it over in person');
  console.log(' or through a one-time secret channel, never by chat or e-mail.');
  console.log(' The user must choose their own password at first sign-in.');
  console.log('================================================================');
}
