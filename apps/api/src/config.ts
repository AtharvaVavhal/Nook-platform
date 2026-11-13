export interface RuntimeConfig {
  readonly appEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly webOrigin: string;
  readonly secureCookies: boolean;
  /**
   * How many reverse proxies sit between the internet and this process (Express `trust proxy`). The client
   * address used for sign-in throttling comes from X-Forwarded-For only to that depth. 0 means "none".
   */
  readonly trustProxyHops: number;
  /** Minimum severity written to the log (LOG_LEVEL): debug, info, warn or error. */
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Sentry DSN (SENTRY_DSN). Absent means error reporting is off. It is a secret: never log or print it. */
  readonly sentryDsn?: string;
  /** Sentry environment tag (SENTRY_ENVIRONMENT), default: APP_ENV. */
  readonly sentryEnvironment: string;
  readonly databaseUrl?: string;
}

const LOG_LEVEL_NAMES = ['debug', 'info', 'warn', 'error'] as const;

/** LOG_LEVEL, validated. Default: info (warn under test, to keep test output readable). */
export function parseLogLevel(
  raw: string | undefined,
  appEnv: string,
): (typeof LOG_LEVEL_NAMES)[number] {
  if (raw === undefined || raw.trim() === '') return appEnv === 'test' ? 'warn' : 'info';
  const value = raw.trim().toLowerCase();
  if (!(LOG_LEVEL_NAMES as readonly string[]).includes(value)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVEL_NAMES.join(', ')}.`);
  }
  return value as (typeof LOG_LEVEL_NAMES)[number];
}

/**
 * A Sentry DSN looks like https://<public key>@<host>/<project id>. Anything else is a configuration mistake, caught at
 * start-up. The error message never contains the value.
 */
export function parseSentryDsn(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('SENTRY_DSN must be a Sentry DSN such as https://<key>@<host>/<project>.');
  }
  if (url.protocol !== 'https:' || !url.username || !/^\/\d+$/.test(url.pathname)) {
    throw new Error('SENTRY_DSN must be a Sentry DSN such as https://<key>@<host>/<project>.');
  }
  return raw.trim();
}

export function parseSentryEnvironment(raw: string | undefined, appEnv: string): string {
  if (raw === undefined || raw.trim() === '') return appEnv;
  const value = raw.trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(value)) {
    throw new Error('SENTRY_ENVIRONMENT must be 1 to 32 letters, digits, "-" or "_".');
  }
  return value;
}

const MAX_PROXY_HOPS = 5;

/**
 * An explicit, bounded hop count. In production it must be stated: left at 0 behind a proxy, every visitor shares
 * the proxy's address and one burst of failed sign-ins would lock everybody out; left too high, a client could
 * forge its own address.
 */
export function parseTrustProxyHops(raw: string | undefined, appEnv: string): number {
  if (raw === undefined || raw.trim() === '') {
    if (appEnv === 'production') {
      throw new Error(
        'TRUST_PROXY_HOPS must be set in production (the number of reverse proxies in front of the API).',
      );
    }
    return 0;
  }
  if (!/^\d+$/.test(raw.trim()) || Number(raw) > MAX_PROXY_HOPS) {
    throw new Error(`TRUST_PROXY_HOPS must be a whole number between 0 and ${MAX_PROXY_HOPS}.`);
  }
  return Number(raw);
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
  // Validate without rewriting operator-supplied startup options or URL encoding.
  return raw;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const rawEnv = env.APP_ENV;
  if (rawEnv === undefined) {
    throw new Error('APP_ENV must be explicitly configured.');
  }
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
  if (rawEnv === 'production' && webOrigin.startsWith('http://')) {
    throw new Error('WEB_ORIGIN must use HTTPS in production.');
  }
  const databaseUrl = parseDatabaseUrl(env.DATABASE_URL);
  const sentryDsn = parseSentryDsn(env.SENTRY_DSN);
  return {
    appEnv: rawEnv as RuntimeConfig['appEnv'],
    port: parsePort(env.PORT),
    webOrigin: origin.origin,
    secureCookies: rawEnv === 'production',
    trustProxyHops: parseTrustProxyHops(env.TRUST_PROXY_HOPS, rawEnv),
    logLevel: parseLogLevel(env.LOG_LEVEL, rawEnv),
    ...(sentryDsn === undefined ? {} : { sentryDsn }),
    sentryEnvironment: parseSentryEnvironment(env.SENTRY_ENVIRONMENT, rawEnv),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
  };
}
