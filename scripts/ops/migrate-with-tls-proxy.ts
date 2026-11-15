// Runs the real Prisma migration command through an authenticated-TLS proxy (see pg-tls-proxy.ts for the why).
//
//   node --import tsx scripts/ops/migrate-with-tls-proxy.ts [-- <command> <args...>]
//
// Default command: npx --no-install prisma migrate deploy --config prisma.config.ts
// Prisma history, checksums and transaction behaviour are untouched: this only changes the transport.
//
// Environment (all from Railway variables on the dedicated migration service; nothing is printed):
//   MIGRATION_DB_HOST      private hostname of the database service
//   MIGRATION_DB_PORT      default 5432
//   MIGRATION_DB_NAME      database name (nook)
//   MIGRATION_DB_USER      the migrator role; a superuser name is refused
//   MIGRATION_DB_PASSWORD  secret
//   DB_CA_PEM              the pinned CA / certificate (PEM; public)
//   DB_CERT_SHA256         SHA-256 fingerprint of the expected server certificate (hex; public)
//
// Exit codes: 0 migrations ok, 1 migration command failed, 2 bad configuration, 3 the TLS endpoint could not be
// authenticated (nothing was migrated).
import { spawn } from 'node:child_process';
import { ProxyError, probeUpstream, startPgTlsProxy } from './pg-tls-proxy.js';

export interface MigrationEnv {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  caPem: string;
  pinSha256: string;
}

const FORBIDDEN_USERS = new Set(['postgres', 'root', 'admin', 'superuser']);

export function parseMigrationEnv(env: NodeJS.ProcessEnv): MigrationEnv {
  const missing = [
    'MIGRATION_DB_HOST',
    'MIGRATION_DB_NAME',
    'MIGRATION_DB_USER',
    'MIGRATION_DB_PASSWORD',
    'DB_CA_PEM',
    'DB_CERT_SHA256',
  ].filter((name) => !env[name] || env[name]?.trim() === '');
  if (missing.length > 0) {
    throw new ProxyError('CONFIG', `Missing required variables: ${missing.join(', ')}.`);
  }
  const port = env.MIGRATION_DB_PORT?.trim() ? Number(env.MIGRATION_DB_PORT) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProxyError('CONFIG', 'MIGRATION_DB_PORT must be an integer between 1 and 65535.');
  }
  const user = env.MIGRATION_DB_USER as string;
  if (FORBIDDEN_USERS.has(user.toLowerCase())) {
    throw new ProxyError(
      'CONFIG',
      'Migrations must not run as a superuser role; use the migrator role.',
    );
  }
  return {
    host: env.MIGRATION_DB_HOST as string,
    port,
    database: env.MIGRATION_DB_NAME as string,
    user,
    password: env.MIGRATION_DB_PASSWORD as string,
    caPem: env.DB_CA_PEM as string,
    pinSha256: env.DB_CERT_SHA256 as string,
  };
}

/** The environment handed to the migration command: the loopback proxy URL replaces every database setting. */
export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  config: MigrationEnv,
  proxyPort: number,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { ...base };
  for (const name of [
    'MIGRATION_DB_PASSWORD',
    'MIGRATION_DB_HOST',
    'MIGRATION_DB_PORT',
    'MIGRATION_DB_NAME',
    'MIGRATION_DB_USER',
    'DB_CA_PEM',
    'DB_CERT_SHA256',
    'MIGRATOR_DATABASE_URL',
  ]) {
    delete child[name];
  }
  // sslmode=disable is deliberate and safe here: the only peer is the in-container loopback proxy.
  child.DATABASE_URL = `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@127.0.0.1:${proxyPort}/${encodeURIComponent(config.database)}?sslmode=disable`;
  child.DOTENV_CONFIG_PATH = '/nonexistent'; // never let a stray .env choose the database
  return child;
}

async function main(): Promise<number> {
  const separator = process.argv.indexOf('--');
  const command =
    separator >= 0 && process.argv.length > separator + 1
      ? process.argv.slice(separator + 1)
      : ['npx', '--no-install', 'prisma', 'migrate', 'deploy', '--config', 'prisma.config.ts'];

  let config: MigrationEnv;
  try {
    config = parseMigrationEnv(process.env);
  } catch (error) {
    console.error(`STOP: ${error instanceof Error ? error.message : 'invalid configuration'}`);
    return 2;
  }
  const upstream = {
    upstreamHost: config.host,
    upstreamPort: config.port,
    caPem: config.caPem,
    pinSha256: config.pinSha256,
  };
  try {
    await probeUpstream(upstream);
  } catch (error) {
    const code = error instanceof ProxyError ? error.code : 'INTERNAL';
    console.error(
      `STOP: the database endpoint could not be authenticated (${code}). No migration was attempted.`,
    );
    return 3;
  }
  console.log(
    'database TLS endpoint authenticated (pinned certificate); starting migration command',
  );
  const proxy = await startPgTlsProxy({
    ...upstream,
    onEvent: (event) => {
      if (event.startsWith('rejected:')) console.error(`proxy ${event}`);
    },
  });
  try {
    return await new Promise<number>((resolve) => {
      const [bin, ...args] = command;
      const child = spawn(bin as string, args, {
        stdio: 'inherit',
        env: buildChildEnv(process.env, config, proxy.port),
      });
      child.once('error', () => resolve(1));
      child.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    await proxy.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    () => process.exit(1),
  );
}
