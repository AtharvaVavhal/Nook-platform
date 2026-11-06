import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createDiagnostics, safeError } from './diagnostics.js';
import { assertG6BEnvironment, runG6BStages, supervise } from './g6b-migration.js';

const secret = 'DO_NOT_EMIT_PASSWORD_4b2';
const sensitive = `${secret} postgresql://user:private@localhost/db Bearer token-123 SELECT 'private-value'`;
const source = fileURLToPath(new URL('./g6b-migration.js', import.meta.url));
function synthetic() {
  const error = new assert.AssertionError({
    message: sensitive,
    actual: sensitive,
    expected: sensitive,
  });
  error.stack = `AssertionError: ${sensitive}\n    at check (${source}:55:9)\n    at elsewhere (/private/secret.ts:1:1)`;
  return error;
}
const capture = () => {
  const lines = [];
  return { lines, diagnostics: createDiagnostics((line) => lines.push(line)) };
};
const records = (lines) =>
  lines.map((line) => ({
    event: line.slice(0, line.indexOf(' ')),
    ...JSON.parse(line.slice(line.indexOf(' ') + 1)),
  }));
const stages = [
  'empty_schema_preflight',
  'migration_lock_acquisition',
  'prisma_deployment',
  'ledger_verification',
  'schema_verification',
  'runtime_grants',
  'runtime_privilege_verification',
  'migration_lock_release',
  'fixture_execution',
  'integration_test_execution',
];
function orchestration(diagnostics, failed) {
  const calls = [];
  const op = (id) => async () => {
    calls.push(id);
    if (id === failed) throw synthetic();
  };
  return {
    calls,
    s: {
      diagnostics,
      preflight: op(stages[0]),
      lock: { acquire: op(stages[1]), assertHeld() {}, release: op(stages[7]) },
      deploy: op(stages[2]),
      ledger: op(stages[3]),
      schema: op(stages[4]),
      grants: op(stages[5]),
      privileges: op(stages[6]),
      fixtures: op(stages[8]),
      tests: op(stages[9]),
      cleanup: op('postrun_verification'),
    },
  };
}

test('assertion diagnostics expose only a verified source location and safe class/code', () => {
  const error = synthetic();
  const info = safeError(error);
  assert.equal(info.name, 'AssertionError');
  assert.equal(info.code, 'ERR_ASSERTION');
  assert.equal(info.diagnostic, 'ASSERTION_LOCATION_FOUND');
  assert.equal(info.source, 'scripts/ci/g6b-migration.js');
  assert.equal(info.line, 55);
  assert.equal(info.column, 9);
  const output = JSON.stringify(info);
  for (const text of [
    secret,
    'postgresql://',
    'Bearer',
    'SELECT',
    'actual',
    'expected',
    '/private/secret',
  ])
    assert.ok(!output.includes(text));
});
for (const frame of [
  '/tmp/fake-repository/scripts/ci/g6b-migration.js:1:1',
  `${source}/../unknown.js:1:1`,
  `${source}:0:1`,
  'https://remote/secret:1:1',
]) {
  test(`unverified source frame is rejected: ${frame.split(':')[0]}`, () => {
    const error = synthetic();
    error.stack = `AssertionError: hidden\n    at check (${frame})`;
    assert.equal(safeError(error).source, 'unknown');
    assert.equal(safeError(error).diagnostic, 'ASSERTION_LOCATION_UNKNOWN');
  });
}
for (const [name, code, diagnostic] of [
  ['IntegrationGuardError', null, 'INTEGRATION_GUARD_FAILURE'],
  ['Error', '42501', 'DATABASE_DRIVER_ERROR'],
  ['AnythingSensitive', sensitive, 'UNKNOWN_ERROR'],
]) {
  test(`safe error classification ${diagnostic}`, () => {
    const info = safeError({ name, code, message: sensitive, stack: sensitive });
    assert.equal(info.diagnostic, diagnostic);
    assert.ok(!JSON.stringify(info).includes(secret));
  });
}
test('successful stages have exact serial start/completion pairs', async () => {
  const c = capture();
  const { s } = orchestration(c.diagnostics);
  await runG6BStages(s);
  const rows = records(c.lines);
  assert.deepEqual(
    rows.filter((x) => x.event === 'NOOK_CI_STAGE_START').map((x) => x.stage),
    [...stages, 'postrun_verification'],
  );
  assert.deepEqual(
    rows.filter((x) => x.event === 'NOOK_CI_STAGE_COMPLETE').map((x) => x.stage),
    [...stages, 'postrun_verification'],
  );
});
for (const failed of [...stages, 'postrun_verification']) {
  test(`failure preserves source, last successful stage and cleanup: ${failed}`, async () => {
    const c = capture();
    const { s, calls } = orchestration(c.diagnostics, failed);
    await assert.rejects(runG6BStages(s));
    c.diagnostics.report(synthetic());
    const rows = records(c.lines);
    const f = rows.find((x) => x.event === 'NOOK_CI_STAGE_FAILED');
    assert.equal(f.stage, failed);
    assert.equal(f.source, 'scripts/ci/g6b-migration.js');
    const index = stages.indexOf(failed);
    if (index >= 0) assert.equal(f.lastSuccessful, index === 0 ? 'none' : stages[index - 1]);
    const later = stages.slice(index + 1).filter((x) => x !== 'migration_lock_release');
    if (index >= 0) for (const stage of later) assert.ok(!calls.includes(stage));
    assert.ok(calls.includes('postrun_verification'));
    assert.ok(!rows.some((x) => x.event === 'NOOK_CI_STAGE_COMPLETE' && x.stage === failed));
    assert.ok(!c.lines.join('\n').includes(secret));
  });
}
test('concurrent operations cannot falsely complete a stage', async () => {
  const c = capture();
  let finish;
  const running = c.diagnostics.run(
    'prisma_deployment',
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await assert.rejects(c.diagnostics.run('schema_verification', async () => {}));
  assert.ok(!c.lines.some((x) => x.startsWith('NOOK_CI_STAGE_COMPLETE')));
  finish();
  await running;
  assert.equal(records(c.lines).filter((x) => x.event === 'NOOK_CI_STAGE_COMPLETE').length, 1);
});
test('cleanup outcome is independent of the original failure', async () => {
  const c = capture();
  const error = synthetic();
  assert.throws(() =>
    c.diagnostics.runSync('hosted_environment_validation', () => {
      throw error;
    }),
  );
  await c.diagnostics.run('cleanup', async () => {});
  c.diagnostics.report(error);
  const report = records(c.lines).at(-1);
  assert.equal(report.stage, 'hosted_environment_validation');
  assert.equal(report.cleanupCompleted, true);
});

for (const mode of [
  'success',
  'nonzero',
  'signal',
  'timeout',
  'heartbeat',
  'SIGINT',
  'SIGTERM',
  'uncertain',
  'overflow',
  'spawn',
]) {
  test(`supervisor safely reports ${mode}`, async () => {
    const c = capture();
    const abort = new AbortController();
    const child = new EventEmitter();
    child.pid = 123456;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const launch = () => {
      if (mode === 'spawn') throw new Error(sensitive);
      setTimeout(() => {
        child.stdout.write(sensitive);
        if (mode === 'heartbeat') abort.abort('heartbeat_loss');
        else if (mode === 'SIGINT' || mode === 'SIGTERM') process.emit(mode);
        else if (mode !== 'timeout')
          child.emit('close', mode === 'nonzero' ? 1 : 0, mode === 'signal' ? 'SIGTERM' : null);
      }, 0);
      return child;
    };
    const stop = async () => {
      if (mode === 'uncertain') {
        const error = new Error(sensitive);
        error.terminationUncertain = true;
        throw error;
      }
      child.emit('close', 0, null);
    };
    let failure;
    try {
      await supervise(
        '/synthetic/node',
        [sensitive],
        {},
        {
          launch,
          stop,
          signal: abort.signal,
          timeout: 15,
          closeTimeout: 15,
          maxBytes: mode === 'overflow' ? 1 : 10000,
          identity: 'prisma',
          diagnostics: c.diagnostics,
        },
      );
    } catch (error) {
      failure = error;
    }
    const rows = records(c.lines);
    const last = rows.at(-1);
    assert.equal(last.child, 'prisma');
    assert.equal(
      last.event,
      mode === 'success' ? 'NOOK_CI_CHILD_COMPLETE' : 'NOOK_CI_CHILD_FAILED',
    );
    assert.equal(Boolean(failure), mode !== 'success');
    if (mode === 'heartbeat') assert.equal(last.heartbeatLost, true);
    if (mode === 'SIGINT' || mode === 'SIGTERM') assert.equal(last.requestedSignal, mode);
    if (mode === 'timeout') assert.equal(last.timeout, true);
    if (mode === 'uncertain') assert.equal(last.terminationConfirmed, false);
    if (mode === 'nonzero') assert.equal(last.exitCode, 1);
    if (mode === 'signal') assert.equal(last.signal, 'SIGTERM');
    if (failure) assert.equal(safeError(failure).diagnostic, 'CHILD_PROCESS_FAILURE');
    assert.ok(!c.lines.join('\n').includes(secret));
  });
}

for (const stage of [
  'hosted_environment_validation',
  'postgres_service_readiness',
  'bootstrap_validation',
  'role_provisioning',
  'database_provisioning',
  'database_identity_preflight',
  'toolchain_resolution',
  'cleanup',
]) {
  test(`setup stage emits failure without false completion: ${stage}`, async () => {
    const c = capture();
    await assert.rejects(
      c.diagnostics.run(stage, async () => {
        throw synthetic();
      }),
    );
    const rows = records(c.lines);
    assert.equal(rows[0].event, 'NOOK_CI_STAGE_START');
    assert.equal(rows[1].event, 'NOOK_CI_STAGE_FAILED');
    assert.equal(rows[1].stage, stage);
    assert.equal(rows.length, 2);
  });
}
test('cleanup failure reports false cleanup outcome without erasing original assertion', async () => {
  const c = capture();
  const error = synthetic();
  await assert.rejects(
    c.diagnostics.run('prisma_deployment', async () => {
      throw error;
    }),
  );
  await assert.rejects(
    c.diagnostics.run('cleanup', async () => {
      throw new Error(sensitive);
    }),
  );
  c.diagnostics.report(error);
  const report = records(c.lines).at(-1);
  assert.equal(report.stage, 'prisma_deployment');
  assert.equal(report.cleanupCompleted, false);
  assert.equal(report.source, 'scripts/ci/g6b-migration.js');
  assert.ok(!c.lines.join('\n').includes(secret));
});

test('redaction never accesses assertion values or raw message', () => {
  const error = synthetic();
  for (const key of ['message', 'actual', 'expected'])
    Object.defineProperty(error, key, {
      get() {
        throw new Error('sensitive getter accessed');
      },
    });
  assert.equal(safeError(error).diagnostic, 'ASSERTION_LOCATION_FOUND');
});
test('stage runner rethrows the original error without discarding its stack', async () => {
  const c = capture();
  const error = synthetic();
  await assert.rejects(
    c.diagnostics.run('hosted_environment_validation', async () => {
      throw error;
    }),
    (caught) => caught === error,
  );
});
test('failure outside a stage survives subsequent cleanup failure', async () => {
  const c = capture();
  const error = synthetic();
  c.diagnostics.report(error);
  await assert.rejects(
    c.diagnostics.run('cleanup', async () => {
      throw new Error('cleanup failed');
    }),
  );
  c.diagnostics.report(error);
  assert.equal(records(c.lines).at(-1).diagnostic, 'ASSERTION_LOCATION_FOUND');
});

test('an actual parent assertion reports its natural repository frame without child attribution', () => {
  let error;
  try {
    assertG6BEnvironment({}, {});
  } catch (caught) {
    error = caught;
  }
  const info = safeError(error);
  assert.equal(info.diagnostic, 'ASSERTION_LOCATION_FOUND');
  assert.equal(info.source, 'scripts/ci/g6b-migration.js');
  assert.ok(info.line > 0 && info.column > 0);
  assert.equal(info.child, undefined);
});
test('uncertain descendants never produce successful postrun verification or unlock', async () => {
  const c = capture();
  const { s, calls } = orchestration(c.diagnostics);
  const error = new Error('withheld');
  error.terminationUncertain = true;
  s.deploy = async () => {
    throw error;
  };
  await assert.rejects(runG6BStages(s), (caught) => caught === error);
  assert.ok(!calls.includes('migration_lock_release'));
  const rows = records(c.lines);
  assert.ok(
    !rows.some((x) => x.event === 'NOOK_CI_STAGE_COMPLETE' && x.stage === 'postrun_verification'),
  );
  assert.ok(
    rows.some((x) => x.event === 'NOOK_CI_STAGE_FAILED' && x.stage === 'postrun_verification'),
  );
});
