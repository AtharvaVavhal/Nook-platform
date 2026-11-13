import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./phase4-disposable.mjs', import.meta.url), 'utf8');

test('full browser profile verifies the manifest and deploys the repository chain', () => {
  assert.match(source, /profile === 'full' \|\| profile === 'full-migration-browser'/);
  assert.match(source, /verifyMigrationFiles\(/);
  assert.match(source, /'migrate', 'deploy'/);
  assert.match(source, /'generate'/);
  assert.match(source, /scripts\/e2e\/corrections\.e2e\.mjs/);
});

test('diagnostic still requires the missing migration and uses its diagnostic SQL', () => {
  assert.match(source, /manifest\.migrations\.slice\(0, -1\)/);
  assert.match(source, /corrections-diagnostic\.sql/);
  assert.match(source, /profile === 'diagnostic' && mode !== 'a6'/);
});

test('new profile requires explicit opt-in and withholds browser and migration output', () => {
  assert.match(source, /process\.env\.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1'/);
  assert.match(source, /Full Prisma migration failed \(output withheld/);
  assert.match(source, /Browser acceptance exit status:.*details withheld/);
  assert.match(source, /NOOK_E2E_SANITIZED: '1'/);
});

test('cleanup verifies this run label before stopping its named resource', () => {
  assert.match(source, /assert\.equal\(label, runId, 'Refusing cleanup/);
  assert.match(source, /docker\(\['stop', '--time', '5', name\]\)/);
  assert.match(source, /label=nook\.phase4\.run=\$\{runId\}/);
});

test('focused transfer verification requires full profile and disposable authorization', () => {
  assert.match(source, /if \(mode === 'transfer-verification'\) \{\s*assert.equal\(profile, 'full'\);\s*assert.equal\(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1'/);
  assert.match(source, /mode === 'transfer-verification' \? \['--import', 'tsx', '--test', 'scripts\/qa\/transfer-verification.test.ts'\]/);
});
