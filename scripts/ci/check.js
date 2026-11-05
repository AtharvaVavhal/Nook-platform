// Static only: never import the provisioning runner, application modules, or database helpers.
import yaml from 'js-yaml'; // Supplied by the locked ESLint dependency tree.
import fs from 'node:fs';
import assert from 'node:assert/strict';

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
assert.deepEqual(Object.keys(workflow.jobs), ['quality', 'full-integration']);
assert.equal(workflow.permissions.contents, 'read');
assert.equal(workflow.jobs.quality.services, undefined);
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
assert.ok(fs.existsSync('scripts/ci/prisma.config.ts'));
assert.ok(fs.existsSync('prisma/schema.prisma'));
const manifest = JSON.parse(read('scripts/ci/test-files.json'));
const testNames = (directory) =>
  fs
    .readdirSync(directory)
    .filter((x) => x.endsWith('.test.ts'))
    .sort();
assert.deepEqual(
  [...manifest.quality, ...manifest['initial-migration'], ...manifest.manual]
    .map((name) => `${name}.test.ts`)
    .sort(),
  testNames('apps/api/test'),
);
assert.deepEqual(manifest['initial-migration'], ['database-migration']);
assert.deepEqual(manifest.manual, ['restore-drill']);
assert.deepEqual(
  manifest.full.map((name) => `${name}.integration.test.ts`).sort(),
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
  read('apps/api/test/database-migration.test.ts').includes('NOOK_DATABASE_TESTS_REQUIRED'),
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
console.log(
  'PASS: YAML, job graph, loopback ports, all backend test routing, preflight imports, guard variables, migration/script references and concurrency.',
);
console.log(
  `Routing: ${manifest.quality.length} backend unit, 1 initial, ${manifest.full.length} full, 1 manual; ${testNames('apps/web/src').length} frontend unit files.`,
);
