import { connectionStringOf, validateEnvironment, type IntegrationConfig } from './guard.js';

/**
 * Environment access for the integration suite. Every accessor re-validates the whole environment with
 * the strict guard (see guard.ts), so none of them can hand out a URL that has not passed it. Failures
 * throw an IntegrationGuardError that names the rule and the variable, never the value. The configuration
 * object carries sanitized metadata only; the password-bearing strings are reachable solely through the two
 * functions below, for the database driver.
 */
export function integrationConfig(env: NodeJS.ProcessEnv = process.env): IntegrationConfig {
  return validateEnvironment(env);
}

/** The runtime-role connection string, validated. For the database driver only; never log it. */
export function requireTestDatabaseUrl(): string {
  return connectionStringOf(integrationConfig().runtime);
}

/** The migrator-role connection string, validated against the runtime URL. Never log it. */
export function requireMigratorDatabaseUrl(): string {
  return connectionStringOf(integrationConfig().migrator);
}

/** The migrator role's user name as the URL names it (not a secret). */
export function migratorRoleName(): string {
  return integrationConfig().migrator.username;
}
