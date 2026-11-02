/**
 * Runtime-role connection string for integration tests. It must come from the environment so
 * no credential is committed. Refuses the host PostgreSQL port 5432 and the development database.
 */
export function requireTestDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL environment variable is required');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL is not a valid connection string');
  }
  const database = url.pathname.replace(/^\//, '');
  if (url.port === '5432' || url.port === '' || database === 'nook_dev') {
    throw new Error('Integration tests refuse port 5432 and the nook_dev database');
  }
  return raw;
}
