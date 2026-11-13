// Static only: never import the provisioning runner, application modules, or database helpers.
import yaml from 'js-yaml'; // Supplied by the locked ESLint dependency tree.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const read = (path) => fs.readFileSync(path, 'utf8');
const workflow = yaml.load(read('.github/workflows/ci.yml'));
const g6a = yaml.load(read('.github/workflows/g6a.yml'));
assert.deepEqual(Object.keys(g6a.on), ['workflow_dispatch']);
assert.deepEqual(Object.keys(g6a.jobs), ['initial-integration']);
assert.equal(g6a.permissions.contents, 'read');
assert.equal(g6a.jobs['initial-integration'].environment, 'g6a-disposable');
assert.equal(
  g6a.jobs['initial-integration'].if,
  "github.event_name == 'workflow_dispatch' && inputs.authorization == 'AUTHORIZE_G6A'",
);
assert.equal(
  g6a.jobs['initial-integration'].steps.at(-1).env.NOOK_CI_G6A_AUTHORIZATION,
  '${{ inputs.authorization }}',
);
assert.deepEqual(Object.keys(workflow.jobs), ['quality', 'full-integration', 'pilot-rehearsals']);
assert.equal(workflow.permissions.contents, 'read');
assert.equal(workflow.jobs.quality.services, undefined);
assert.equal(
  workflow.jobs['full-integration'].services.postgres.image,
  'postgres:17.10-bookworm@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f',
  'G6B requires the reviewed immutable PostgreSQL 17 image',
);
assert.equal(
  workflow.jobs.quality.steps.find((step) => step.name === 'Backend Prettier').run,
  "npx --no-install prettier --check apps/api '!apps/api/src/generated/**'",
);
for (const [job, profile, port] of [
  ['initial-integration', 'initial-migration', 5544],
  ['full-integration', 'full', 5545],
]) {
  const spec = job === 'initial-integration' ? g6a.jobs[job] : workflow.jobs[job];
  if (job === 'full-integration') assert.equal(spec.needs, 'quality');
  else assert.equal(spec.needs, undefined);
  assert.equal(spec['runs-on'], 'ubuntu-latest');
  assert.deepEqual(spec.services.postgres.ports, [`127.0.0.1:${port}:5432`]);
  assert.equal(spec.steps.at(-1).run, `node --import tsx scripts/ci/integration.js ${profile}`);
}
// pilot-rehearsals: disposable Docker PostgreSQL only; no service container, no secrets, same pinned image as full-integration.
const rehearsals = workflow.jobs['pilot-rehearsals'];
assert.equal(rehearsals.needs, 'quality');
assert.equal(rehearsals['runs-on'], 'ubuntu-latest');
assert.equal(rehearsals.services, undefined);
assert.ok(rehearsals['timeout-minutes'] <= 20);
assert.ok(
  !JSON.stringify(rehearsals).includes('secrets.') &&
    !JSON.stringify(rehearsals).includes('github.token'),
);
const rehearsalStep = rehearsals.steps.at(-1);
assert.equal(
  rehearsalStep.run,
  'node --import tsx scripts/qa/pilot-phase1-disposable.mjs migration-recovery',
);
assert.equal(rehearsalStep.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1');
assert.equal(
  rehearsalStep.env.NOOK_DISPOSABLE_PG_IMAGE,
  workflow.jobs['full-integration'].services.postgres.image,
);
for (const file of [
  'scripts/qa/pilot-phase1-disposable.mjs',
  'scripts/qa/pilot-migration-recovery.test.ts',
]) {
  assert.ok(fs.existsSync(file), file);
}
assert.ok(fs.existsSync('scripts/ci/prisma.config.ts'));
assert.ok(fs.existsSync('prisma/schema.prisma'));
const manifest = JSON.parse(read('scripts/ci/test-files.json'));
const testNames = (directory) =>
  fs
    .readdirSync(directory)
    .filter((x) => x.endsWith('.test.ts'))
    .sort();
assert.deepEqual(
  [...manifest.quality, ...manifest.manual].map((name) => `${name}.test.ts`).sort(),
  testNames('apps/api/test'),
);
assert.deepEqual(manifest['initial-migration'], ['database-migration']);
assert.deepEqual(manifest.manual, ['restore-drill']);
assert.deepEqual(
  [
    ...manifest.full.map((name) => `${name}.integration.test.ts`),
    ...manifest['initial-migration'].map((name) => `${name}.test.ts`),
  ].sort(),
  testNames('apps/api/test/integration'),
);
for (const name of manifest.full) {
  const code = read(`apps/api/test/integration/${name}.integration.test.ts`);
  assert.equal(/^import\b.*$/m.exec(code)?.[0], "import './helpers/preflight.js';");
}
const guard = read('apps/api/test/integration/helpers/guard.ts');
const runner = read('scripts/ci/integration.js');
for (const name of [
  'NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB',
  'NOOK_INTEGRATION_PROFILE',
  'DATABASE_URL',
  'MIGRATOR_DATABASE_URL',
  'TEST_OWNER_PASSWORD',
]) {
  assert.ok(guard.includes(name) && runner.includes(name), name);
}
assert.ok(runner.includes("'--test-concurrency=1'"));
assert.ok(runner.includes('await deployFoundation(owner, env.MIGRATOR_DATABASE_URL)'));
assert.ok(
  runner.includes("if (profile === 'initial-migration') assertG6AAuthorization(process.env)"),
);
assert.ok(read('scripts/ci/g6a-migration.js').includes("'deploy'"));
assert.ok(read('scripts/ci/g6a-prisma.config.ts').includes("env('NOOK_CI_G6A_MIGRATIONS_DIR')"));
assert.ok(runner.includes('DATABASE_MARKER'));
assert.ok(runner.includes('validateEnvironment(env)'));
assert.ok(
  read('apps/api/test/integration/database-migration.test.ts').includes(
    'NOOK_DATABASE_TESTS_REQUIRED',
  ),
);
for (const dir of fs
  .readdirSync('prisma/migrations', { withFileTypes: true })
  .filter((x) => x.isDirectory())) {
  assert.ok(fs.existsSync(`prisma/migrations/${dir.name}/migration.sql`));
}
for (const job of Object.values({ ...workflow.jobs, ...g6a.jobs })) {
  for (const step of job.steps) {
    for (const match of (step.run ?? '').matchAll(/scripts\/ci\/[a-z-]+\.js/g)) {
      assert.ok(fs.existsSync(match[0]));
    }
    for (const match of (step.run ?? '').matchAll(
      /npm run ([\w:-]+)(?: --workspace (@nook\/(?:api|web)))?/g,
    )) {
      const packagePath = match[2] ? `apps/${match[2].split('/')[1]}/package.json` : 'package.json';
      assert.ok(JSON.parse(read(packagePath)).scripts[match[1]], match[0]);
    }
  }
}
assert.ok(
  !workflow.jobs.quality.steps.some(
    (step) =>
      step.run === 'npm test' ||
      /integration.js|test:database|test:integration|restore-drill/.test(step.run ?? ''),
  ),
);
// G6B checks remain static: never import the deployment modules or a PostgreSQL driver.
for (const file of [
  'g6b-migration.js',
  'g6b-prisma.config.ts',
  'g6b-migrations.json',
  'migration-ledger.js',
  'g6b-preflight.js',
  'g6b-migration.test.js',
  'migration-ledger.test.js',
  'g6b-preflight.test.js',
]) {
  assert.ok(fs.existsSync(`scripts/ci/${file}`), file);
}
const history = JSON.parse(read('scripts/ci/g6b-migrations.json'));
assert.equal(history.version, 1);
assert.equal(history.provider, 'postgresql');
assert.equal(history.migrations.length, 24);
const migrationNames = history.migrations.map((m) => m.name);
assert.equal(new Set(migrationNames).size, 24);
assert.deepEqual(migrationNames, [...migrationNames].sort());
assert.deepEqual(
  fs.readdirSync('prisma/migrations').sort(),
  [...migrationNames, 'migration_lock.toml'].sort(),
);
assert.equal(
  read('prisma/migrations/migration_lock.toml')
    .replace(/#[^\n]*/g, '')
    .trim(),
  'provider = "postgresql"',
);
for (const m of history.migrations) {
  assert.match(m.name, /^\d{14}_[a-z0-9_]+$/);
  assert.match(m.checksum, /^[0-9a-f]{64}$/);
  const path = `prisma/migrations/${m.name}/migration.sql`;
  assert.ok(!fs.lstatSync(`prisma/migrations/${m.name}`).isSymbolicLink());
  assert.ok(fs.lstatSync(path).isFile() && !fs.lstatSync(path).isSymbolicLink());
  assert.equal(createHash('sha256').update(fs.readFileSync(path)).digest('hex'), m.checksum);
}
assert.ok(runner.includes('await deployFull('));
assert.ok(
  !runner.includes('readdirSync') &&
    !runner.includes("owner.query('BEGIN')") &&
    !runner.includes('migration.sql'),
);
const fullRunner = read('scripts/ci/g6b-migration.js');
assert.ok(!fullRunner.includes('spawnSync'));
assert.ok(read('scripts/ci/g6b-preflight.js').includes('verifyFreshLedger(ledger.rows, expected)'));
assert.ok(fullRunner.includes('PRISMA_SCHEMA_ENGINE_BINARY: engine'));
const stages = fullRunner.slice(
  fullRunner.indexOf('export async function runG6BStages'),
  fullRunner.indexOf('export async function deployFull'),
);
let stagePosition = -1;
for (const call of [
  's.preflight()',
  's.lock.acquire()',
  's.deploy()',
  's.ledger()',
  's.schema()',
  's.grants()',
  's.privileges()',
  's.lock.release()',
  's.fixtures()',
  's.tests()',
]) {
  const next = stages.indexOf(call);
  assert.ok(next > stagePosition, call);
  stagePosition = next;
}
const fullConfig = read('scripts/ci/g6b-prisma.config.ts');
assert.ok(fullConfig.includes("env('MIGRATOR_DATABASE_URL')"));
assert.ok(fullConfig.includes("env('NOOK_CI_G6B_MIGRATIONS_DIR')"));
assert.ok(!fullConfig.includes("env('DATABASE_URL')") && !fullConfig.includes("import 'dotenv"));
assert.equal(
  workflow.jobs.quality.steps.find((s) => s.name === 'Offline G6B deployment and ledger tests').run,
  'node --import tsx --test scripts/ci/g6b-migration.test.js scripts/ci/migration-ledger.test.js scripts/ci/g6b-preflight.test.js',
);
console.log(
  'PASS: YAML, job graph, routing, guards, G6A separation, G6B manifest hashes and acceptance ordering.',
);
console.log(
  `Routing: ${manifest.quality.length} backend unit, 1 initial, ${manifest.full.length} full, 1 manual; ${testNames('apps/web/src').length} frontend unit files.`,
);
