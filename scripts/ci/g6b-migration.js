import { attachChildFailure } from './diagnostics.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { validateEnvironment } from '../../apps/api/test/integration/helpers/guard.ts';
import { SuiteLock } from '../../apps/api/test/integration/helpers/suite-lock.ts';
import {
  TARGET,
  readFreshFacts,
  readIdentity,
  readPrivileges,
  readSchema,
  readLedger,
  verifyFreshFacts,
  verifyIdentityFacts,
  verifyPrivileges,
  verifySchemaFacts,
} from './g6b-preflight.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = () => new Error('G6B child failed; raw engine output withheld');

export function assertG6BEnvironment(hosted, env) {
  assert.equal(hosted.GITHUB_ACTIONS, 'true');
  assert.equal(hosted.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(hosted.GITHUB_JOB, 'full-integration');
  assert.ok(hosted.CI_BOOTSTRAP_PASSWORD);
  for (const key of Object.keys(hosted))
    assert.ok(
      !/^PG[A-Z0-9_]*$/.test(key) &&
        !['NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_OPTIONS'].includes(key) &&
        !key.startsWith('PRISMA_'),
      'Ambient configuration forbidden',
    );
  const c = validateEnvironment(env);
  assert.equal(c.profile, 'full');
  for (const [target, role] of [
    [c.runtime, TARGET.runtime],
    [c.migrator, TARGET.migrator],
  ]) {
    assert.equal(target.host, TARGET.host);
    assert.equal(target.port, TARGET.port);
    assert.equal(target.database, TARGET.database);
    assert.equal(target.username, role);
  }
  return c;
}

export function verifyManifest(manifest) {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.provider, 'postgresql');
  assert.equal(manifest.migrations.length, 24);
  const names = manifest.migrations.map((m) => m.name);
  assert.equal(new Set(names).size, 24);
  assert.deepEqual(names, [...names].sort());
  assert.equal(names[0], '20261031154500_slice_2_2_foundation');
  for (const m of manifest.migrations) {
    assert.match(m.name, /^\d{14}_[a-z0-9_]+$/);
    assert.match(m.checksum, /^[0-9a-f]{64}$/);
  }
}

export function verifyMigrationFiles(directory, manifest) {
  verifyManifest(manifest);
  assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  const entries = readdirSync(directory).sort();
  assert.deepEqual(
    entries,
    [...manifest.migrations.map((m) => m.name), 'migration_lock.toml'].sort(),
  );
  const lock = join(directory, 'migration_lock.toml');
  assert.ok(lstatSync(lock).isFile() && !lstatSync(lock).isSymbolicLink());
  const provider = readFileSync(lock, 'utf8')
    .replace(/#[^\n]*/g, '')
    .trim();
  assert.equal(provider, 'provider = "postgresql"');
  for (const m of manifest.migrations) {
    const dir = join(directory, m.name);
    assert.ok(lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink());
    assert.deepEqual(readdirSync(dir), ['migration.sql']);
    const sql = join(dir, 'migration.sql');
    assert.ok(lstatSync(sql).isFile() && !lstatSync(sql).isSymbolicLink());
    assert.equal(
      digest(readFileSync(sql)),
      m.checksum,
      `Reviewed migration checksum mismatch: ${m.name}`,
    );
  }
}

export function stageMigrations(source, manifest) {
  verifyMigrationFiles(source, manifest);
  const directory = mkdtempSync(join(tmpdir(), 'nook-g6b-migrations-'));
  try {
    copyFileSync(join(source, 'migration_lock.toml'), join(directory, 'migration_lock.toml'));
    for (const m of manifest.migrations) {
      mkdirSync(join(directory, m.name));
      copyFileSync(join(source, m.name, 'migration.sql'), join(directory, m.name, 'migration.sql'));
    }
    verifyMigrationFiles(directory, manifest);
    return { directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function lockedCLI(root = ROOT) {
  const installed = JSON.parse(
    readFileSync(resolve(root, 'node_modules/prisma/package.json'), 'utf8'),
  );
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  assert.equal(installed.version, '7.10.1');
  assert.equal(installed.version, lock.packages['node_modules/prisma'].version);
  assert.equal(installed.version, lock.packages[''].devDependencies.prisma);
  const bin = resolve(root, 'node_modules/prisma', installed.bin.prisma);
  assert.equal(bin, resolve(root, 'node_modules/prisma/build/index.js'));
  assert.ok(lstatSync(bin).isFile() && !lstatSync(bin).isSymbolicLink());
  assert.equal(
    realpathSync(bin),
    resolve(realpathSync(root), 'node_modules/prisma/build/index.js'),
  );
  return bin;
}

// Prevent Prisma from downloading an absent engine during deployment. This is a trusted local
// override, never inherited from the operator; its target comes from the pinned platform helper.
export function lockedEngine(root, target) {
  assert.match(target, /^[a-z0-9.-]+$/);
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  for (const name of ['@prisma/engines', '@prisma/engines-version', '@prisma/get-platform']) {
    const requireEngine = createRequire(resolve(root, 'node_modules/@prisma/engines/package.json'));
    const packageFile = requireEngine.resolve(`${name}/package.json`);
    const key = relative(realpathSync(root), realpathSync(packageFile))
      .replaceAll('\\', '/')
      .replace(/\/package\.json$/, '');
    assert.ok(key.startsWith('node_modules/'));
    const installed = JSON.parse(readFileSync(packageFile, 'utf8'));
    assert.equal(installed.version, lock.packages[key].version);
    if (name !== '@prisma/engines-version') assert.equal(installed.version, '7.10.1');
  }
  const binary = resolve(root, 'node_modules/@prisma/engines', `schema-engine-${target}`);
  const info = lstatSync(binary);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.mode & 0o111);
  assert.equal(
    realpathSync(binary),
    resolve(realpathSync(root), 'node_modules/@prisma/engines', `schema-engine-${target}`),
  );
  return binary;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function stopProcessGroup(
  pid,
  { kill = process.kill, sleep: pause = sleep, attempts = 20, interval = 100 } = {},
) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Invalid process group');
  const alive = () => {
    try {
      kill(-pid, 0);
      return true;
    } catch (e) {
      if (e.code === 'ESRCH') return false;
      throw e;
    }
  };
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (!alive()) return;
    try {
      kill(-pid, signal);
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
    for (let i = 0; i < attempts; i++) {
      await pause(interval);
      if (!alive()) return;
    }
  }
  const error = fail();
  error.terminationUncertain = true;
  throw error;
}

// A process group contains the CLI and its inherited engine children. No shell, no output relay.
export async function supervise(
  executable,
  args,
  options,
  {
    launch = spawn,
    stop = stopProcessGroup,
    timeout = 120000,
    maxBytes = 4 * 1024 * 1024,
    signal,
    closeTimeout = 5000,
    diagnostics,
    identity = 'unknown',
    onOutput,
  } = {},
) {
  assert.ok(!signal?.aborted, 'G6B aborted before child launch');
  diagnostics?.child('START', identity);
  const info = {
    exitCode: null,
    signal: null,
    timeout: false,
    heartbeatLost: false,
    outputOverflow: false,
    terminationConfirmed: false,
  };
  let child;
  try {
    child = launch(executable, args, {
      ...options,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    info.errorCode = error?.code;
    diagnostics?.child('FAILED', identity, { ...info, terminationConfirmed: true });
    throw attachChildFailure(fail(), identity, { ...info, terminationConfirmed: true });
  }
  let bytes = 0;
  let bad = false;
  let closed = false;
  let finish;
  let finishing = false;
  let terminated = false;
  const closedPromise = new Promise((r) =>
    child.once('close', (code, signal) => {
      closed = true;
      info.exitCode = code;
      info.signal = signal;
      if (code !== 0 || signal) bad = true;
      r();
      void finish();
    }),
  );
  let completion;
  const done = new Promise((resolveDone, rejectDone) => {
    finish = async () => {
      if (finishing) return;
      finishing = true;
      try {
        if (child.pid) await stop(child.pid);
        else assert.ok(bad, 'Missing child PID');
        terminated = true;
        if (!closed) {
          let timer;
          try {
            await Promise.race([
              closedPromise,
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(fail()), closeTimeout);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
        info.terminationConfirmed = true;
        if (bad) throw fail();
        diagnostics?.child('COMPLETE', identity, info);
        resolveDone();
      } catch (error) {
        const safe = fail();
        safe.terminationUncertain = Boolean(error.terminationUncertain || !terminated || !closed);
        info.terminationConfirmed = !safe.terminationUncertain;
        attachChildFailure(safe, identity, info);
        diagnostics?.child('FAILED', identity, info);
        rejectDone(safe);
      }
    };
    completion = () => {
      bad = true;
      void finish();
    };
    const childError = (error) => {
      info.errorCode = error?.code;
      completion();
    };
    child.once('error', childError);
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('error', childError);
      stream?.on('data', (data) => {
        bytes += Buffer.byteLength(data);
        if (bytes > maxBytes) {
          info.outputOverflow = true;
          completion();
          return;
        }
        if (!bad && stream === child.stdout && onOutput) {
          try {
            onOutput(data);
          } catch {
            completion();
          }
        }
      });
    }
  });
  const timer = setTimeout(() => {
    info.timeout = true;
    completion();
  }, timeout);
  const sigint = () => {
    info.requestedSignal = 'SIGINT';
    completion();
  };
  const sigterm = () => {
    info.requestedSignal = 'SIGTERM';
    completion();
  };
  const heartbeatLost = () => {
    info.heartbeatLost = signal?.reason === 'heartbeat_loss';
    completion();
  };
  signal?.addEventListener('abort', heartbeatLost, { once: true });
  process.once('SIGINT', sigint);
  process.once('SIGTERM', sigterm);
  if (signal?.aborted) heartbeatLost();
  try {
    await done;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', heartbeatLost);
    process.removeListener('SIGINT', sigint);
    process.removeListener('SIGTERM', sigterm);
  }
}

export function migrationLock(db, abort) {
  return new SuiteLock(
    {
      tryAdvisoryLock: async () =>
        Boolean(
          (
            await db.query(
              "SELECT pg_try_advisory_lock(hashtextextended('nook:integration-suite', 0)) AS locked",
            )
          ).rows[0].locked,
        ),
      ping: async () => {
        await db.query('SELECT 1');
      },
      onLost: (listener) => {
        db.on('error', () => listener('lock connection error'));
        db.on('end', () => listener('lock connection ended'));
      },
      close: async () => {
        await db.end();
      },
    },
    {
      now: () => Date.now(),
      sleep,
      every: (fn, ms) => {
        const t = setInterval(fn, ms);
        t.unref();
        return { stop: () => clearInterval(t) };
      },
    },
    () => abort.abort('heartbeat_loss'),
  );
}

// Kept pure with injected stages so failure ordering and cleanup can be proven offline.
export async function runG6BStages(s) {
  let error;
  let released = false;
  const stage = (name, operation) =>
    s.diagnostics ? s.diagnostics.run(name, operation) : operation();
  const check = () => {
    s.lock.assertHeld();
    s.check?.();
  };
  try {
    await stage('empty_schema_preflight', () => s.preflight());
    await stage('migration_lock_acquisition', async () => {
      await s.lock.acquire();
      check();
    });
    await stage('prisma_deployment', async () => {
      await s.deploy();
      check();
    });
    await stage('ledger_verification', async () => {
      await s.ledger();
      check();
    });
    await stage('schema_verification', async () => {
      await s.schema();
      check();
    });
    await stage('runtime_grants', () => s.grants());
    await stage('runtime_privilege_verification', async () => {
      await s.privileges();
      check();
    });
    await stage('migration_lock_release', () => s.lock.release());
    released = true;
    await stage('fixture_execution', () => s.fixtures());
    await stage('integration_test_execution', () => s.tests());
  } catch (e) {
    error = e;
    throw e;
  } finally {
    // Never intentionally release a lock while descendants may still be executing SQL.
    try {
      if (!released && !error?.terminationUncertain)
        await stage('migration_lock_release', () => s.lock.release());
    } finally {
      await stage('postrun_verification', async () => {
        await s.cleanup({ terminationUncertain: Boolean(error?.terminationUncertain) });
        // A callback returning while hosted teardown is still required is not verification success.
        if (error?.terminationUncertain) throw error;
      });
    }
  }
}

export async function deployFull(
  {
    hosted,
    env,
    bootstrap,
    owner,
    lockClient,
    runtime,
    verifier,
    grantVerifier,
    grants,
    fixtures,
    tests,
    cleanup,
    abort,
    diagnostics,
  },
  { run = supervise, root = ROOT } = {},
) {
  const diagnosticStage = (name, operation) =>
    diagnostics ? diagnostics.run(name, operation) : operation();
  await diagnosticStage('hosted_environment_validation', () => assertG6BEnvironment(hosted, env));
  assert.deepEqual([...bootstrap.databases].sort(), ['postgres', 'template0', 'template1']);
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'scripts/ci/g6b-migrations.json'), 'utf8'),
  );
  const source = resolve(root, 'prisma/migrations');
  const { binary, engine } = await diagnosticStage('toolchain_resolution', async () => {
    const binary = lockedCLI(root);
    const platform = createRequire(resolve(root, 'node_modules/@prisma/engines/package.json'))(
      '@prisma/get-platform',
    );
    const engine = lockedEngine(root, await platform.getBinaryTargetForCurrentPlatform());
    return { binary, engine };
  });
  let staging;
  const lock = migrationLock(lockClient, abort);
  let identity;
  const sameServer = (other) => {
    assert.equal(other.server, identity.server);
    assert.equal(other.serverPort, identity.serverPort);
    assert.equal(other.postmaster, identity.postmaster);
  };
  await runG6BStages({
    diagnostics,
    lock,
    check: () => assert.ok(!abort.signal.aborted),
    preflight: async () => {
      const fresh = await readFreshFacts(owner);
      verifyFreshFacts(fresh);
      identity = fresh.identity;
      assert.equal(identity.postmaster, bootstrap.postmaster);
      assert.equal(identity.server, bootstrap.server);
      assert.equal(identity.serverPort, bootstrap.serverPort);
      const lockIdentity = await readIdentity(lockClient);
      verifyIdentityFacts(lockIdentity, TARGET.migrator);
      sameServer(lockIdentity);
      const runtimeIdentity = await readIdentity(runtime);
      verifyIdentityFacts(runtimeIdentity, TARGET.runtime);
      sameServer(runtimeIdentity);
      verifyPrivileges(await readPrivileges(owner, TARGET.runtime), TARGET.runtime, 'before');
      staging = stageMigrations(source, manifest);
    },
    deploy: async () => {
      assert.ok(!abort.signal.aborted);
      const fresh = await readFreshFacts(owner);
      verifyFreshFacts(fresh);
      sameServer(fresh.identity);
      verifyMigrationFiles(staging.directory, manifest);
      await run(
        process.execPath,
        [binary, 'migrate', 'deploy', '--config', resolve(root, 'scripts/ci/g6b-prisma.config.ts')],
        {
          cwd: root,
          env: {
            PATH: env.PATH,
            PRISMA_SCHEMA_ENGINE_BINARY: engine,
            MIGRATOR_DATABASE_URL: env.MIGRATOR_DATABASE_URL,
            NOOK_CI_G6B_MIGRATIONS_DIR: staging.directory,
          },
        },
        { signal: abort.signal, diagnostics, identity: 'prisma' },
      );
      verifyMigrationFiles(staging.directory, manifest);
    },
    ledger: async () => {
      await grantVerifier();
      const result = await readLedger(verifier, manifest.migrations);
      sameServer(result.identity);
    },
    schema: async () => {
      verifySchemaFacts(await readSchema(owner));
    },
    grants,
    privileges: async () => {
      verifyPrivileges(await readPrivileges(owner, TARGET.runtime), TARGET.runtime);
    },
    fixtures,
    tests,
    cleanup: async (state) => {
      if (!state.terminationUncertain) staging?.cleanup();
      await cleanup(state);
    },
  });
}
