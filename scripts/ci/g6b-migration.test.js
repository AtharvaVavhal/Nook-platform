// Reporter tests are selected through this import; do not also select their entry file.
import './integration-test-reporter.test.js';
// Keep database-free diagnostic regression coverage in the existing hosted G6B test selection.
import './diagnostics.test.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  deployFull,
  assertG6BEnvironment,
  ROOT,
  verifyManifest,
  verifyMigrationFiles,
  stageMigrations,
  lockedCLI,
  lockedEngine,
  supervise,
  stopProcessGroup,
  runG6BStages,
  migrationLock,
} from './g6b-migration.js';
const manifest = JSON.parse(readFileSync(new URL('./g6b-migrations.json', import.meta.url)));
const hosted = () => ({
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_JOB: 'full-integration',
  CI_BOOTSTRAP_PASSWORD: 'synthetic',
});
const environment = () => ({
  PATH: process.env.PATH,
  APP_ENV: 'test',
  NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB: '1',
  NOOK_INTEGRATION_PROFILE: 'full',
  TEST_OWNER_PASSWORD: 'synthetic',
  DATABASE_URL:
    'postgresql://nook_ci_full_runtime:synthetic@127.0.0.1:5545/nook_integration_ci_full',
  MIGRATOR_DATABASE_URL:
    'postgresql://nook_ci_full_migrator:synthetic@127.0.0.1:5545/nook_integration_ci_full',
});
const source = resolve(ROOT, 'prisma/migrations');
function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nook-g6b-unit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function migrationCopy(t) {
  const directory = temp(t);
  for (const m of manifest.migrations) {
    mkdirSync(join(directory, m.name));
    copyFileSync(join(source, m.name, 'migration.sql'), join(directory, m.name, 'migration.sql'));
  }
  copyFileSync(join(source, 'migration_lock.toml'), join(directory, 'migration_lock.toml'));
  return directory;
}
test('approved source migration set has exactly 18 lexically ordered hashes', () =>
  verifyMigrationFiles(source, manifest));
for (const [name, mutate] of [
  ['count', (m) => m.migrations.pop()],
  ['order', (m) => m.migrations.reverse()],
  ['duplicate', (m) => (m.migrations[1] = m.migrations[0])],
  ['provider', (m) => (m.provider = 'mysql')],
  ['path traversal', (m) => (m.migrations[1].name = '../bad')],
  ['checksum syntax', (m) => (m.migrations[1].checksum = 'bad')],
])
  test(`manifest rejects ${name}`, () => {
    const m = structuredClone(manifest);
    mutate(m);
    assert.throws(() => verifyManifest(m));
  });
for (const kind of [
  'missing',
  'extra-directory',
  'symlink',
  'sql-symlink',
  'provider',
  'changed-bytes',
  'wrong-hash',
])
  test(`files reject ${kind}`, (t) => {
    const directory = migrationCopy(t);
    const first = join(directory, manifest.migrations[0].name);
    const m = structuredClone(manifest);
    if (kind === 'missing') rmSync(join(first, 'migration.sql'));
    if (kind === 'extra-directory') mkdirSync(join(directory, 'unexpected'));
    if (kind === 'symlink') {
      rmSync(first, { recursive: true });
      symlinkSync(join(source, manifest.migrations[0].name), first);
    }
    if (kind === 'sql-symlink') {
      rmSync(join(first, 'migration.sql'));
      symlinkSync(
        join(source, manifest.migrations[0].name, 'migration.sql'),
        join(first, 'migration.sql'),
      );
    }
    if (kind === 'provider')
      writeFileSync(join(directory, 'migration_lock.toml'), 'provider = "mysql"');
    if (kind === 'changed-bytes') writeFileSync(join(first, 'migration.sql'), '-- changed');
    if (kind === 'wrong-hash') m.migrations[0].checksum = '0'.repeat(64);
    assert.throws(() => verifyMigrationFiles(directory, m));
  });
test('staging copies exact files, detects staging mismatch, and removes private directory', () => {
  const staged = stageMigrations(source, manifest);
  try {
    verifyMigrationFiles(staged.directory, manifest);
    writeFileSync(
      join(staged.directory, manifest.migrations[0].name, 'migration.sql'),
      '-- tampered',
    );
    assert.throws(() => verifyMigrationFiles(staged.directory, manifest));
  } finally {
    staged.cleanup();
  }
  assert.equal(existsSync(staged.directory), false);
});
test('hosted full-profile disposable contract accepted', () =>
  assertG6BEnvironment(hosted(), environment()));
for (const key of ['GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'GITHUB_JOB', 'CI_BOOTSTRAP_PASSWORD'])
  test(`hosted contract requires ${key}`, () => {
    const h = hosted();
    delete h[key];
    assert.throws(() => assertG6BEnvironment(h, environment()));
  });
for (const key of [
  'PGHOST',
  'PGSERVICE',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_OPTIONS',
  'PRISMA_SCHEMA_ENGINE_BINARY',
])
  test(`ambient ${key} refused`, () =>
    assert.throws(() => assertG6BEnvironment({ ...hosted(), [key]: 'synthetic' }, environment())));
for (const [name, replacement] of [
  ['host', 'localhost'],
  ['port', '5544'],
  ['database', 'nook_test'],
  ['role', 'wrong_migrator'],
])
  test(`wrong ${name} refused before any connection`, () => {
    const e = environment();
    e.MIGRATOR_DATABASE_URL = e.MIGRATOR_DATABASE_URL.replace(
      name === 'host'
        ? '127.0.0.1'
        : name === 'port'
          ? '5545'
          : name === 'database'
            ? 'nook_integration_ci_full'
            : 'nook_ci_full_migrator',
      replacement,
    );
    assert.throws(() => assertG6BEnvironment(hosted(), e));
  });
for (const type of ['unsafe-profile', 'runtime-url', 'missing-owner-password'])
  test(`environment refuses ${type}`, () => {
    const e = environment();
    if (type === 'unsafe-profile') e.NOOK_INTEGRATION_PROFILE = 'initial-migration';
    if (type === 'runtime-url') e.DATABASE_URL = e.MIGRATOR_DATABASE_URL;
    if (type === 'missing-owner-password') delete e.TEST_OWNER_PASSWORD;
    assert.throws(() => assertG6BEnvironment(hosted(), e));
  });
function fakeCLI(t, version = '7.10.1', binary = true) {
  const root = temp(t);
  mkdirSync(join(root, 'node_modules/prisma/build'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules/prisma/package.json'),
    JSON.stringify({ version, bin: { prisma: 'build/index.js' } }),
  );
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({
      packages: {
        'node_modules/prisma': { version: '7.10.1' },
        '': { devDependencies: { prisma: '7.10.1' } },
      },
    }),
  );
  if (binary) writeFileSync(join(root, 'node_modules/prisma/build/index.js'), '// never executed');
  return root;
}
test('CLI resolves locked local executable', (t) => {
  const root = fakeCLI(t);
  assert.equal(lockedCLI(root), join(root, 'node_modules/prisma/build/index.js'));
});
for (const [name, version, binary] of [
  ['wrong version', '7.10.2', true],
  ['missing binary', '7.10.1', false],
])
  test(`CLI rejects ${name}`, (t) => assert.throws(() => lockedCLI(fakeCLI(t, version, binary))));

function childHarness(mode = 'success') {
  const child = new EventEmitter();
  child.pid = 43210;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const calls = [];
  const launch = (exe, args, options) => {
    calls.push({ exe, args, options });
    queueMicrotask(() => {
      if (mode === 'success') child.emit('close', 0, null);
      if (mode === 'nonzero') child.emit('close', 1, null);
      if (mode === 'signal') child.emit('close', null, 'SIGTERM');
      if (mode === 'spawn-error') {
        child.pid = undefined;
        child.emit('error', new Error('synthetic-secret'));
        child.emit('close', null, null);
      }
      if (mode === 'overflow') child.stderr.write('synthetic-secret'.repeat(10));
    });
    return child;
  };
  let stopped = 0;
  const stop = async () => {
    stopped++;
    child.emit('close', null, 'SIGKILL');
  };
  return { launch, stop, calls, child, stopped: () => stopped };
}
for (const mode of ['success', 'nonzero', 'signal', 'spawn-error', 'overflow', 'timeout'])
  test(`supervisor handles ${mode} without output disclosure`, async () => {
    const h = childHarness(mode);
    const promise = supervise(
      'synthetic-node',
      ['synthetic-cli'],
      { env: {} },
      { launch: h.launch, stop: h.stop, timeout: 15, maxBytes: 20, closeTimeout: 20 },
    );
    if (mode === 'success') await promise;
    else await assert.rejects(promise, (e) => !e.message.includes('synthetic-secret'));
    if (mode !== 'spawn-error') assert.equal(h.stopped(), 1);
    assert.equal(h.calls[0].options.detached, true);
    assert.deepEqual(h.calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
  });
for (const sig of ['SIGINT', 'SIGTERM'])
  test(`supervisor terminates group on ${sig}`, async () => {
    const h = childHarness('wait');
    const p = supervise('mock', [], {}, { launch: h.launch, stop: h.stop });
    process.emit(sig);
    await assert.rejects(p);
    assert.equal(h.stopped(), 1);
  });
test('heartbeat abort terminates CLI and descendants before rejection', async () => {
  const h = childHarness('wait');
  const a = new AbortController();
  const p = supervise('mock', [], {}, { launch: h.launch, stop: h.stop, signal: a.signal });
  a.abort();
  await assert.rejects(p);
  assert.equal(h.stopped(), 1);
});
test('supervisor refuses pre-aborted deployment without spawning', async () => {
  const a = new AbortController();
  a.abort();
  await assert.rejects(
    supervise(
      'mock',
      [],
      {},
      {
        signal: a.signal,
        launch: () => {
          throw new Error('must not launch');
        },
      },
    ),
  );
});
test('supervisor marks uncertain descendant cleanup', async () => {
  const h = childHarness();
  await assert.rejects(
    supervise(
      'mock',
      [],
      {},
      {
        launch: h.launch,
        stop: async () => {
          throw new Error('permission denied');
        },
      },
    ),
    (e) => e.terminationUncertain === true,
  );
});
test('process-group termination escalates TERM to KILL and verifies disappearance', async () => {
  let alive = true;
  const signals = [];
  await stopProcessGroup(123, {
    attempts: 1,
    interval: 1,
    sleep: async () => {},
    kill: (pid, sig) => {
      assert.equal(pid, -123);
      if (!alive) {
        const e = new Error();
        e.code = 'ESRCH';
        throw e;
      }
      if (sig !== 0) signals.push(sig);
      if (sig === 'SIGKILL') alive = false;
    },
  });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});
test('process-group uncertainty fails closed', async () => {
  await assert.rejects(
    stopProcessGroup(123, { attempts: 1, interval: 1, sleep: async () => {}, kill: () => {} }),
    (e) => e.terminationUncertain,
  );
});

function stages(failure) {
  const events = [];
  const mark = async (n) => {
    events.push(n);
    if (n === failure) throw new Error('synthetic failure');
  };
  const lock = {
    acquire: () => mark('lock'),
    assertHeld: () => {},
    release: () => mark('release'),
  };
  return {
    events,
    lock,
    ...Object.fromEntries(
      [
        'preflight',
        'deploy',
        'ledger',
        'schema',
        'grants',
        'privileges',
        'fixtures',
        'tests',
        'cleanup',
      ].map((n) => [n, () => mark(n)]),
    ),
  };
}
const order = [
  'preflight',
  'lock',
  'deploy',
  'ledger',
  'schema',
  'grants',
  'privileges',
  'release',
  'fixtures',
  'tests',
  'cleanup',
];
test('full orchestration order and cleanup', async () => {
  const s = stages();
  await runG6BStages(s);
  assert.deepEqual(s.events, order);
});
for (const stage of order.filter((n) => !['release', 'cleanup'].includes(n)))
  test(`failure at ${stage} skips subsequent work and attempts cleanup`, async () => {
    const s = stages(stage);
    await assert.rejects(runG6BStages(s));
    assert.equal(s.events.at(-1), 'cleanup');
    const index = order.indexOf(stage);
    for (const later of order.slice(index + 1))
      if (!['release', 'cleanup'].includes(later)) assert.ok(!s.events.includes(later));
  });
test('uncertain termination prevents intentional lock release but requests cleanup', async () => {
  const s = stages();
  s.deploy = async () => {
    const e = new Error();
    e.terminationUncertain = true;
    throw e;
  };
  await assert.rejects(runG6BStages(s));
  assert.ok(!s.events.includes('release'));
  assert.equal(s.events.at(-1), 'cleanup');
});
test('migration lock uses real suite advisory key and heartbeat loss aborts', async () => {
  const events = {};
  const a = new AbortController();
  let closed = false;
  const db = {
    query: async (sql) => {
      assert.match(sql, /nook:integration-suite/);
      return { rows: [{ locked: true }] };
    },
    on: (name, fn) => (events[name] = fn),
    end: async () => {
      closed = true;
    },
  };
  const lock = migrationLock(db, a);
  await lock.acquire();
  events.error();
  assert.equal(a.signal.aborted, true);
  assert.throws(() => lock.assertHeld());
  await lock.release();
  assert.equal(closed, true);
});
test('lock acquisition failure blocks deployment', async () => {
  const a = new AbortController();
  const db = {
    query: async () => {
      throw new Error('synthetic refusal');
    },
    on: () => {},
    end: async () => {},
  };
  const lock = migrationLock(db, a);
  await assert.rejects(lock.acquire());
  assert.throws(() => lock.assertHeld());
});
test('dedicated Prisma config cannot load root/dotenv/runtime URL', () => {
  const config = readFileSync(new URL('./g6b-prisma.config.ts', import.meta.url), 'utf8');
  assert.match(config, /env\('MIGRATOR_DATABASE_URL'\)/);
  assert.match(config, /env\('NOOK_CI_G6B_MIGRATIONS_DIR'\)/);
  assert.ok(!config.includes("env('DATABASE_URL')"));
  assert.ok(!config.includes("import 'dotenv"));
  assert.ok(!config.includes("from '../../prisma.config"));
});

// All adapters below are in-memory; the injected CLI records arguments but launches nothing.
test('deployment wrapper stages exact history, isolates CLI environment and gates real adapters', async () => {
  const { SCHEMA, TARGET } = await import('./g6b-preflight.js');
  const { DATABASE_MARKER } = await import('../../apps/api/test/integration/helpers/guard.ts');
  const { LEDGER_COLUMNS } = await import('./migration-ledger.js');
  let deployed = false;
  let granted = false;
  let verifierGranted = false;
  let cliCalls = 0;
  const events = [];
  const ident = (role) => ({
    database: TARGET.database,
    user: role,
    sessionUser: role,
    marker: DATABASE_MARKER,
    databaseOwner: TARGET.migrator,
    recovery: false,
    server: 'mock-server',
    serverPort: 5432,
    postmaster: 'mock-postmaster',
    version: 170000,
    dangerous: [],
    memberships: role === TARGET.migrator ? ['pg_database_owner'] : [],
    databases: ['postgres', 'template0', 'template1', TARGET.database],
    otherConnections: [],
  });
  const rowMap = (map, fn) => Object.entries(map).map(([name, value]) => ({ name, ...fn(value) }));
  const queryFor = (role) => async (sql, params) => {
    if (sql.startsWith('SELECT current_database')) return { rows: [ident(role)] };
    if (sql.includes('AS "ownsObjects"'))
      return {
        rows: [{ ownsObjects: 0, createSchema: false, createDatabase: false, tempDatabase: false }],
      };
    if (sql.includes('array_agg(p.priv')) {
      const user = params[0];
      return {
        rows:
          user === TARGET.verifier
            ? [{ name: '_prisma_migrations', privileges: ['SELECT'] }]
            : granted
              ? Object.keys(SCHEMA.tables).map((name) => ({
                  name,
                  privileges:
                    name === 'audit_events' ? ['INSERT', 'SELECT'] : ['INSERT', 'SELECT', 'UPDATE'],
                }))
              : [],
      };
    }
    if (sql.includes('AS objects')) {
      assert.equal(deployed, false);
      return { rows: [{ userSchemas: ['public'], schemaOwner: 'pg_database_owner', objects: [] }] };
    }
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (role === TARGET.verifier) {
      assert.ok(deployed && verifierGranted);
      if (sql.includes('c.relname AS name,c.relkind'))
        return {
          rows: [
            { schema: 'public', name: '_prisma_migrations', kind: 'r', owner: TARGET.migrator },
          ],
        };
      if (sql.includes('information_schema.columns'))
        return {
          rows: Object.entries(LEDGER_COLUMNS).map(([name, [type, length, nullable]]) => ({
            name,
            type,
            length,
            nullable,
            default: name === 'started_at' ? 'now()' : name === 'applied_steps_count' ? '0' : null,
          })),
        };
      if (sql.includes('pg_constraint')) return { rows: [{ name: 'id' }] };
      if (sql.includes('extract(epoch'))
        return {
          rows: manifest.migrations.map((m, i) => ({
            id: String(i),
            migration_name: m.name,
            checksum: m.checksum,
            started_at: String(i * 10),
            finished_at: String(i * 10 + 1),
            rolled_back_at: null,
            logs: null,
            applied_steps_count: 1,
          })),
        };
      return { rows: [] };
    }
    assert.ok(deployed);
    if (sql.includes('COALESCE('))
      return {
        rows: [
          ...rowMap(SCHEMA.tables, (columns) => ({ columns, owner: TARGET.migrator, kind: 'r' })),
          { name: '_prisma_migrations', owner: TARGET.migrator, kind: 'r', columns: {} },
        ],
      };
    if (sql.includes('pg_enum')) return { rows: rowMap(SCHEMA.enums, (labels) => ({ labels })) };
    if (sql.includes('pg_get_constraintdef'))
      return {
        rows: rowMap(SCHEMA.constraints, (x) => ({
          ...x,
          validated: true,
          deferrable: false,
          deferred: false,
        })),
      };
    if (sql.includes('FROM pg_index'))
      return { rows: rowMap(SCHEMA.indexes, (x) => ({ ...x, valid: true, ready: true })) };
    if (sql.includes('pg_get_function_result'))
      return {
        rows: rowMap(SCHEMA.functions, (body) => ({
          body,
          owner: TARGET.migrator,
          language: 'plpgsql',
          result: 'trigger',
          arguments: 0,
          securityDefiner: false,
          config: null,
          volatility: 'v',
          parallel: 'u',
          leakproof: false,
          strict: false,
        })),
      };
    if (sql.includes('FROM pg_trigger'))
      return {
        rows: rowMap(SCHEMA.triggers, (x) => ({ ...x, enabled: 'O', when: null, arguments: 0 })),
      };
    if (sql.includes('foreignOwnedObjects'))
      return {
        rows: [
          {
            userSchemas: ['public'],
            schemaOwner: 'pg_database_owner',
            foreignOwnedObjects: 0,
            unexpectedObjects: 0,
          },
        ],
      };
    throw new Error('Unexpected mocked query');
  };
  const connection = (role) => ({
    query: queryFor(role),
    on: () => {},
    end: async () => events.push('lock-close'),
  });
  await deployFull(
    {
      hosted: hosted(),
      env: environment(),
      bootstrap: {
        databases: ['postgres', 'template0', 'template1'],
        server: 'mock-server',
        serverPort: 5432,
        postmaster: 'mock-postmaster',
      },
      owner: connection(TARGET.migrator),
      lockClient: connection(TARGET.migrator),
      runtime: connection(TARGET.runtime),
      verifier: connection(TARGET.verifier),
      abort: new AbortController(),
      grantVerifier: async () => {
        assert.ok(deployed && !granted);
        verifierGranted = true;
        events.push('verifier-grant');
      },
      grants: async () => {
        assert.ok(deployed && verifierGranted);
        granted = true;
        events.push('runtime-grant');
      },
      fixtures: async () => {
        assert.ok(granted);
        assert.ok(events.includes('lock-close'));
        events.push('fixtures');
      },
      tests: async () => events.push('tests'),
      cleanup: async () => events.push('cleanup'),
    },
    {
      run: async (exe, args, options, supervision) => {
        cliCalls++;
        assert.equal(exe, process.execPath);
        assert.equal(args[0], lockedCLI());
        assert.deepEqual(args.slice(1), [
          'migrate',
          'deploy',
          '--config',
          resolve(ROOT, 'scripts/ci/g6b-prisma.config.ts'),
        ]);
        assert.deepEqual(Object.keys(options.env).sort(), [
          'MIGRATOR_DATABASE_URL',
          'NOOK_CI_G6B_MIGRATIONS_DIR',
          'PATH',
          'PRISMA_SCHEMA_ENGINE_BINARY',
        ]);
        assert.equal(options.env.MIGRATOR_DATABASE_URL, environment().MIGRATOR_DATABASE_URL);
        assert.equal(options.cwd, ROOT);
        assert.ok(supervision.signal);
        verifyMigrationFiles(options.env.NOOK_CI_G6B_MIGRATIONS_DIR, manifest);
        deployed = true;
        events.push('deploy');
      },
    },
  );
  assert.equal(cliCalls, 1);
  assert.deepEqual(events, [
    'deploy',
    'verifier-grant',
    'runtime-grant',
    'lock-close',
    'fixtures',
    'tests',
    'cleanup',
  ]);
});

test('missing engine refuses deployment without downloading', (t) => {
  assert.throws(() => lockedEngine(fakeCLI(t), 'darwin-arm64'));
});
test('engine target cannot escape locked installation', () =>
  assert.throws(() => lockedEngine(ROOT, '../elsewhere')));

for (const mode of ['valid', 'version', 'symlink', 'not-executable'])
  test(`locked engine: ${mode}`, (t) => {
    const root = fakeCLI(t);
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
    for (const name of ['@prisma/engines', '@prisma/engines-version', '@prisma/get-platform']) {
      const version = name === '@prisma/engines-version' ? '8.1.0-synthetic' : '7.10.1';
      mkdirSync(join(root, 'node_modules', name), { recursive: true });
      writeFileSync(
        join(root, 'node_modules', name, 'package.json'),
        JSON.stringify({
          version: mode === 'version' && name === '@prisma/engines' ? 'wrong' : version,
        }),
      );
      lock.packages[`node_modules/${name}`] = { version };
    }
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
    const binary = join(root, 'node_modules/@prisma/engines/schema-engine-synthetic');
    writeFileSync(binary, 'never executed');
    chmodSync(binary, mode === 'not-executable' ? 0o644 : 0o755);
    if (mode === 'symlink') {
      rmSync(binary);
      symlinkSync(join(root, 'node_modules/prisma/build/index.js'), binary);
    }
    if (mode === 'valid') assert.equal(lockedEngine(root, 'synthetic'), binary);
    else assert.throws(() => lockedEngine(root, 'synthetic'));
  });

test('integration test child selects API tsconfig for real TSX decorator transformation', async () => {
  const ts = (await import('typescript')).default;
  const { runInNewContext } = await import('node:vm');
  const { spawnSync } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const source = ts.createSourceFile(
    'integration.js',
    readFileSync(new URL('./integration.js', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const spawns = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'supervise')
      spawns.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(spawns.length, 1);
  const options = spawns[0].arguments[2];
  assert.ok(ts.isObjectLiteralExpression(options));
  const envProperty = options.properties.find((p) => p.name?.getText(source) === 'env');
  const cwdProperty = options.properties.find((p) => p.name?.getText(source) === 'cwd');
  assert.equal(cwdProperty.initializer.getText(source), 'process.cwd()');
  // Evaluate only the production spawn's pure environment expression. Importing
  // integration.js itself would run database bootstrap and is forbidden here.
  const envExpression =
    envProperty.initializer?.getText(source) ?? envProperty.name.getText(source);
  const base = { PATH: process.env.PATH, APP_ENV: 'test' };
  const childEnvironment = (args) =>
    runInNewContext(`(${envExpression})`, { args, env: base, ROOT, resolve });
  assert.equal(childEnvironment(['scripts/ci/seed-fixtures.js']), base);
  const child = childEnvironment(['--test']);
  const config = resolve(ROOT, 'apps/api/tsconfig.json');
  assert.ok(existsSync(config));
  const target = pathToFileURL(resolve(ROOT, 'apps/api/src/auth/auth.controller.ts')).href;
  const probe = `import {registerHooks} from 'node:module';
    const target=${JSON.stringify(target)};
    registerHooks({resolve(s,c,next){
      if(s===target||s.startsWith('node:'))return next(s,c);
      throw new Error('NOOK_DIAGNOSTIC_DEPENDENCY_BOUNDARY');
    }});
    let kind='unexpected';
    try{await import(target);}catch(e){
      if(e.name==='TransformError'&&String(e.message).includes('Parameter decorators only work when experimental decorators are enabled'))kind='decorator_failure';
      else if(e.message==='NOOK_DIAGNOSTIC_DEPENDENCY_BOUNDARY')kind='dependency_boundary';
    }
    console.log(JSON.stringify({kind,configMatches:process.env.TSX_TSCONFIG_PATH===${JSON.stringify(config)}}));`;
  const transform = (env) => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', probe],
      {
        cwd: ROOT,
        env: { ...env, TSX_DISABLE_CACHE: '1' },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(transform(base), { kind: 'decorator_failure', configMatches: false });
  assert.equal(child.TSX_TSCONFIG_PATH, config);
  assert.equal(Object.hasOwn(base, 'TSX_TSCONFIG_PATH'), false);
  assert.equal(Object.hasOwn(child, 'NODE_OPTIONS'), false);
  assert.deepEqual(transform(child), { kind: 'dependency_boundary', configMatches: true });
});
