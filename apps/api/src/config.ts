export interface RuntimeConfig {
  readonly appEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly webOrigin: string;
  readonly databaseUrl?: string;
}

export function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 3000;
  if (!/^\d+$/.test(raw)) throw new Error('PORT must be an integer between 1 and 65535.');
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

export function parseDatabaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// scheme.');
  }
  return raw;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const rawEnv = env.APP_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(rawEnv)) {
    throw new Error('APP_ENV must be development, test, or production.');
  }
  const webOrigin = env.WEB_ORIGIN ?? 'http://localhost:5173';
  let origin: URL;
  try {
    origin = new URL(webOrigin);
  } catch {
    throw new Error('WEB_ORIGIN must be an absolute origin URL.');
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== webOrigin.replace(/\/$/, '')
  ) {
    throw new Error('WEB_ORIGIN must be a valid HTTP(S) origin without a path.');
  }
  const databaseUrl = parseDatabaseUrl(env.DATABASE_URL);
  return {
    appEnv: rawEnv as RuntimeConfig['appEnv'],
    port: parsePort(env.PORT),
    webOrigin: origin.origin,
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
  };
}
