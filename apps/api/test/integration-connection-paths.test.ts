import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// A static scan of the test tree (no database, no network). It makes the list of ways a test can reach
// PostgreSQL explicit, so a new path cannot appear without a conscious, reviewed change to this file.

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SELF = 'integration-connection-paths.test.ts';

const files = readdirSync(TEST_DIR, { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.ts'))
  .map((name) => name.split(path.sep).join('/'))
  .filter((name) => name !== SELF)
  .sort();
const source = (name: string) => readFileSync(path.join(TEST_DIR, name), 'utf8');
const withMatch = (pattern: RegExp) => files.filter((name) => pattern.test(source(name)));

/** The only two files that may construct a pg client. Both sit behind the verified connection factory. */
const CLIENT_BUILDERS = ['integration/helpers/db.ts', 'integration/helpers/isolation.ts'];

/**
 * Child processes, each reviewed: they inherit or are handed the already-verified environment and start only
 * after the parent process has passed the preflight and holds the suite lock.
 *  - invoice-scheduler.integration.test.ts runs the billing job for one organization (`--org`) it created.
 *  - account-security.integration.test.ts runs the operator scripts with the verified environment.
 *  - restore-drill.test.ts runs a shell script against fake, unreachable hosts and touches no database.
 */
const CHILD_PROCESS_USERS = [
  'integration/account-security.integration.test.ts',
  'integration/invoice-scheduler.integration.test.ts',
  'restore-drill.test.ts',
];

/**
 * Files that name a credential variable straight from the environment instead of through the guarded helpers.
 *  - account-security.integration.test.ts hands the already-verified migrator URL to the operator scripts it
 *    runs as child processes.
 *  - di.test.ts is a unit test that DELETES DATABASE_URL for its duration so that no database is configured
 *    (the health route must answer 503), then restores it. It can only remove a connection, never create one.
 */
const DIRECT_CREDENTIAL_READERS = [
  'di.test.ts',
  'integration/account-security.integration.test.ts',
];

test('the scan sees the test tree', () => {
  assert.ok(files.length > 20, `expected to scan the test tree, found ${files.length} files`);
  assert.ok(files.includes('integration/helpers/guard.ts'));
});

test('only the two guarded helpers may build a pg client or pool, or import the driver', () => {
  const pattern =
    /\bnew\s+(?:pg\.)?(?:Client|Pool)\s*\(|^\s*import\s+(?!type\b)[^;]*\bfrom\s+['"]pg['"]|\brequire\(\s*['"]pg['"]\s*\)|\bPoolClient\b|\bpg\.(?:Client|Pool)\b/m;
  assert.deepEqual(withMatch(pattern), [...CLIENT_BUILDERS].sort());
});

test('the client factories refuse to run before the preflight and the lock check', () => {
  const db = source('integration/helpers/db.ts');
  assert.match(db, /assertSuiteLockHeld\(\)/);
  const factories = db.match(
    /export function create(?:Migrator|Runtime)Client\(\)[^{]*\{\s*requireVerified\(\);/g,
  );
  assert.equal(factories?.length, 2, 'both synchronous factories start with requireVerified()');
  assert.match(db, /await ensureIsolatedDatabase\(\);/);
});

test('every integration test file, and the migration test, imports the preflight before anything else', () => {
  const required = [
    ...files.filter((name) => /^integration\/[^/]+\.integration\.test\.ts$/.test(name)),
    'database-migration.test.ts',
  ];
  assert.ok(required.length >= 13, 'the integration files and the migration test are all covered');
  for (const name of required) {
    const firstImport = /^import\b.*$/m.exec(source(name))?.[0];
    const expected = name.startsWith('integration/')
      ? "import './helpers/preflight.js';"
      : "import './integration/helpers/preflight.js';";
    assert.equal(firstImport, expected, `${name} must import the preflight first`);
  }
});

test('database tests take their connections from the verified helper, not from the environment', () => {
  const pattern = /process\.env\.(?:MIGRATOR_)?DATABASE_URL\b/;
  assert.deepEqual(withMatch(pattern), DIRECT_CREDENTIAL_READERS);
});

test('child processes that could reach a database are an explicit, reviewed list', () => {
  const pattern = /from\s+['"](?:node:)?child_process['"]/;
  assert.deepEqual(withMatch(pattern), [...CHILD_PROCESS_USERS].sort());
});

test('no test executes TRUNCATE (privileges are inspected, never exercised)', () => {
  const executed = /[`'"]\s*TRUNCATE\s+(?:TABLE\s+)?\w+/i;
  assert.deepEqual(withMatch(executed), []);
});

test('the guard and lock modules are pure: no driver import, no direct database access', () => {
  for (const name of ['integration/helpers/guard.ts', 'integration/helpers/suite-lock.ts']) {
    const text = source(name);
    assert.ok(!/from\s+['"]pg['"]/.test(text), `${name} must not import pg`);
    assert.ok(
      !/process\.env\b/.test(text.replace(/\/\*[\s\S]*?\*\//g, '')),
      `${name} reads no environment`,
    );
  }
});
