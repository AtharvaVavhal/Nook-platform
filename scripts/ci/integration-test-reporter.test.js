import test from 'node:test';
import assert from 'node:assert/strict';
import reporter, { createTestProtocol } from './integration-test-reporter.js';
const names = [
  'account-security',
  'auth',
  'booking',
  'checkin',
  'corrections',
  'cross-origin',
  'finance',
  'hostel-scale',
  'inventory',
  'invoice-scheduler',
  'lifecycle',
  'observability',
  'resident-enquiry',
  'uuid-params',
];
const FILE_COUNT = names.length;
assert.equal(FILE_COUNT, 14, 'the full integration list is pinned at fourteen files');
const line = (event, data) => `NOOK_TEST_${event} ${JSON.stringify(data)}\n`;
const result = { tests: 2, passed: 1, failed: 0, skipped: 1, todo: 0, cancelled: 0 };
test('fourteen independent files retain order and counts', () => {
  const output = [];
  const p = createTestProtocol((s) => output.push(s));
  for (const name of names) {
    const file = `${name}.integration.test.ts`;
    p.push(line('FILE_START', { file }));
    p.push(line('FILE_RESULT', { file, status: 'completed', ...result }));
    p.push(line('FILE_COMPLETE', { file }));
  }
  p.finish();
  const summary = JSON.parse(output.at(-1).split(' ').slice(1).join(' '));
  assert.equal(summary.tests, FILE_COUNT * 2);
  assert.equal(summary.passed, FILE_COUNT);
  assert.equal(summary.files_completed, FILE_COUNT);
});
for (const [label, record] of [
  ['unknown file', line('FILE_START', { file: 'secret' })],
  ['wrong order', line('FILE_START', { file: 'auth.integration.test.ts' })],
  ['malformed json', 'NOOK_TEST_FILE_START {\n'],
  ['unknown record', 'NOOK_TEST_RAW {}\n'],
])
  test(label, () => assert.throws(() => createTestProtocol(() => {}).push(record)));
test('missing results fail closed and arbitrary output is discarded', () => {
  const out = [];
  const p = createTestProtocol((s) => out.push(s));
  p.push('password=synthetic postgresql://secret Bearer secret SELECT secret\n');
  assert.throws(() => p.finish());
  assert.ok(!out.join('').includes('secret'));
});
test('reporter suppresses names, messages, output and assertion values', async () => {
  const file = fileURLToPath(
    new URL(
      '../../apps/api/test/integration/account-security.integration.test.ts',
      import.meta.url,
    ),
  );
  const secret = 'sensitive-password-token';
  async function* events() {
    yield {
      type: 'test:dequeue',
      data: { file, name: cliPathFor(file), nesting: 0, parentId: 0, type: 'test' },
    };
    yield { type: 'test:stdout', data: { file, message: secret } };
    yield {
      type: 'test:fail',
      data: {
        file,
        name: secret,
        details: {
          error: {
            name: 'AssertionError',
            code: 'ERR_ASSERTION',
            message: secret,
            actual: secret,
            expected: secret,
            stack: secret,
          },
        },
      },
    };
    yield {
      type: 'test:summary',
      data: { file, success: false, counts: { ...result, passed: 0, failed: 1 } },
    };
  }
  const out = [];
  for await (const s of reporter(events())) out.push(s);
  assert.ok(!out.join('').includes(secret));
  assert.ok(out.join('').includes('ASSERTION_LOCATION_UNKNOWN'));
});

test('real Node reporter: nested tests, two files, secrets and nonzero exit', async () => {
  const { writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = await prepareReporterFixture('safe');
  try {
    const first = cliPathFor('account-security.integration.test.ts');
    const second = cliPathFor('auth.integration.test.ts');
    writeFileSync(
      join(dir, first),
      `import { test, describe } from 'node:test'; describe('secret-name',()=>{test('pass',()=>{});test.skip('skip',()=>{});test.todo('todo');});`,
    );
    writeFileSync(
      join(dir, second),
      `import { test } from 'node:test'; import assert from 'node:assert/strict'; test('secret-name',()=>{console.log('synthetic-secret');console.error('synthetic-secret');assert.equal('synthetic-secret','other');});`,
    );
    const child = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-concurrency=1',
        '--test-reporter=./scripts/ci/integration-test-reporter.js',
        first,
        second,
      ],
      { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } },
    );
    assert.equal(child.status, 1);
    assert.ok(!child.stdout.includes('synthetic-secret'));
    assert.ok(!child.stdout.includes('secret-name'));
    const output = [];
    const protocol = createTestProtocol((s) => output.push(s));
    protocol.push(child.stdout);
    assert.throws(() => protocol.finish()); // Remaining files never started.
    const summary = JSON.parse(output.at(-1).slice('NOOK_TEST_SUITE_RESULT '.length));
    assert.equal(summary.files_completed, 2);
    assert.equal(summary.files_not_started, FILE_COUNT - 2);
    assert.equal(summary.tests, 4);
    assert.equal(summary.failed, 1);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.todo, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
for (const [label, change] of [
  ['negative', { tests: -1 }],
  ['fractional', { passed: 0.5 }],
  ['inconsistent', { tests: 9 }],
  ['false success', { passed: 0, failed: 1 }],
])
  test(`reject ${label} counts`, () => {
    const p = createTestProtocol(() => {});
    const file = 'account-security.integration.test.ts';
    p.push(line('FILE_START', { file }));
    assert.throws(() =>
      p.push(line('FILE_RESULT', { file, status: 'completed', ...result, ...change })),
    );
  });
test('duplicate results and premature completion fail closed', () => {
  const file = 'account-security.integration.test.ts';
  const p = createTestProtocol(() => {});
  p.push(line('FILE_START', { file }));
  p.push(line('FILE_RESULT', { file, status: 'completed', ...result }));
  assert.throws(() => p.push(line('FILE_RESULT', { file, status: 'completed', ...result })));
});
test('oversized protocol input fails closed', () => {
  assert.throws(() => createTestProtocol(() => {}).push('x'.repeat(65537)));
});

// Independent path and event fixtures; never use implementation allowlists as expectations.
import { safeError, safeSourceLocation } from './diagnostics.js';
import { withTestProtocol } from './integration-test-reporter.js';
import { supervise, runG6BStages } from './g6b-migration.js';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const validSource = 'apps/api/test/integration/booking.integration.test.ts';
const sensitiveValues = [
  'synthetic-password-78db',
  'postgresql://synth:private@host/database',
  'Bearer synthetic-token-889',
  "SELECT 'synthetic-private-literal'",
  'private-request-body-910',
];
const privateText = sensitiveValues.join(' ');
const decode = (s) => JSON.parse(s.slice(s.indexOf(' ') + 1));
const assertPrivate = (value) => {
  for (const secret of sensitiveValues) assert.ok(!JSON.stringify(value).includes(secret));
};
for (const [label, path, row, col, expected] of [
  ['relative', validSource, 4, 2, validSource],
  ['absolute', repo + validSource, 4, 2, validSource],
  ['outside', '/private/external-secret.ts', 4, 2, 'unknown'],
  ['parent', '../' + validSource, 4, 2, 'unknown'],
  [
    'internal traversal',
    'apps/api/test/integration/../integration/booking.integration.test.ts',
    4,
    2,
    'unknown',
  ],
  ['windows', '..\\private\\secret.ts', 4, 2, 'unknown'],
  ['file URL', 'file://' + repo + validSource, 4, 2, 'unknown'],
  ['https URL', 'https://user:password@host/file.ts', 4, 2, 'unknown'],
  ['query', repo + validSource + '?password=synthetic', 4, 2, 'unknown'],
  ['credentials', repo + 'user:password@' + validSource, 4, 2, 'unknown'],
  ['zero line', validSource, 0, 2, 'unknown'],
  ['negative line', validSource, -1, 2, 'unknown'],
  ['fractional column', validSource, 1, 0.5, 'unknown'],
  ['missing line', validSource, undefined, 2, 'unknown'],
  ['missing file', 'apps/api/test/integration/nonexistent.ts', 4, 2, 'unknown'],
])
  test(`source validation: ${label}`, () => {
    assert.equal(safeSourceLocation(path, row, col).source, expected);
  });
test('first valid repository frame survives reporter and parent without private error data', async () => {
  const error = new assert.AssertionError({
    message: privateText,
    actual: privateText,
    expected: privateText,
  });
  error.stack = `AssertionError: ${privateText}\n    at /private/external.ts:9:3\n    at ${repo + validSource}:44:9\n    at ${repo}scripts/ci/integration.js:2:1`;
  const safe = safeError(error);
  assert.equal(safe.source, validSource);
  assert.equal(safe.line, 44);
  const output = [];
  const protocol = createTestProtocol((s) => output.push(s));
  protocol.push(line('FILE_START', { file: 'account-security.integration.test.ts' }));
  protocol.push(
    line('FAILURE', {
      file: 'account-security.integration.test.ts',
      index: 1,
      ...safe,
      message: privateText,
      actual: privateText,
      expected: privateText,
    }),
  );
  assert.throws(() => protocol.finish());
  const failure = decode(output.find((x) => x.startsWith('NOOK_TEST_FAILURE ')));
  assert.equal(failure.source, validSource);
  assert.equal(failure.code, 'ERR_ASSERTION');
  assert.equal(failure.sourceFound, true);
  assert.equal(failure.fileIndex, 1);
  assertPrivate(output);
});
for (const stack of [
  '',
  'malformed stack',
  `Error: ${privateText}\n    at ${repo + validSource}:-1:2`,
  `Error\n    at ${repo + validSource}:2.5:1`,
  `Error\n    at ${repo + validSource}:2`,
])
  test(`malformed stack is unknown (${stack.length})`, () => {
    const info = safeError({ name: 'AssertionError', stack });
    assert.equal(info.source, 'unknown');
    assertPrivate(info);
  });
for (const [name, code, classification] of [
  ['UnknownPrivateClass', 'private-code', 'UNKNOWN_ERROR'],
  ['Error', '23505', 'DATABASE_DRIVER_ERROR'],
  ['TypeError', undefined, 'UNKNOWN_ERROR'],
])
  test(`safe classification ${classification} ${name}`, () => {
    const info = safeError({ name, code, message: privateText, stack: privateText });
    assert.equal(info.diagnostic, classification);
    assertPrivate(info);
  });

async function reportEvents(events) {
  const output = [];
  async function* stream() {
    const file = events[0]?.data.file;
    if (file)
      yield {
        type: 'test:dequeue',
        data: { file, name: cliPathFor(file), nesting: 0, parentId: 0, type: 'test' },
      };
    yield* events;
  }
  for await (const s of reporter(stream())) output.push(s);
  return output;
}
const eventFile = fileURLToPath(
  new URL('../../apps/api/test/integration/account-security.integration.test.ts', import.meta.url),
);
for (const [label, summary] of [
  ['empty', { tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 }],
  ['cancelled', { tests: 2, passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 2 }],
  ['multiple failures', { tests: 2, passed: 0, failed: 2, skipped: 0, todo: 0, cancelled: 0 }],
])
  test(`reporter accounts ${label}`, async () => {
    const output = await reportEvents([
      {
        type: 'test:summary',
        data: { file: eventFile, success: label === 'empty', counts: summary },
      },
    ]);
    assert.deepEqual(
      Object.fromEntries(Object.keys(summary).map((k) => [k, decode(output[1])[k]])),
      summary,
    );
  });
test('suite and parent failures do not create duplicate failed-test ordinals', async () => {
  const error = { name: 'Error', failureType: 'subtestsFailed' };
  const output = await reportEvents([
    { type: 'test:fail', data: { file: eventFile, details: { type: 'suite', error } } },
    { type: 'test:fail', data: { file: eventFile, details: { type: 'test', error } } },
    {
      type: 'test:fail',
      data: {
        file: eventFile,
        details: {
          type: 'test',
          error: { cause: { name: 'AssertionError', code: 'ERR_ASSERTION', message: privateText } },
        },
      },
    },
  ]);
  assert.equal(output.filter((s) => s.startsWith('NOOK_TEST_FAILURE ')).length, 1);
  assertPrivate(output);
});
for (const mode of ['empty stream', 'interrupted', 'reporter throws', 'bad summary'])
  test(`reporter ${mode} cannot become successful`, async () => {
    const out = [];
    async function* stream() {
      if (mode === 'empty stream') return;
      yield {
        type: 'test:dequeue',
        data: {
          file: eventFile,
          name: cliPathFor(eventFile),
          nesting: 0,
          parentId: 0,
          type: 'test',
        },
      };
      yield { type: 'test:start', data: { file: eventFile } };
      if (mode === 'reporter throws') throw new Error(privateText);
      if (mode === 'bad summary')
        yield {
          type: 'test:summary',
          data: { file: eventFile, success: true, counts: { tests: -1 } },
        };
    }
    const p = createTestProtocol((s) => out.push(s));
    try {
      for await (const s of reporter(stream())) p.push(s);
    } catch {
      /* parent still finalizes */
    }
    assert.throws(() => p.finish());
    const summary = decode(out.at(-1));
    assert.equal(summary.files_incomplete, mode === 'empty stream' ? 0 : 1);
    assert.equal(summary.files_not_started, mode === 'empty stream' ? FILE_COUNT : FILE_COUNT - 1);
    assert.equal(summary.counts_complete, false);
    assertPrivate(out);
  });
test('malformed record stays rejected through finalization without echoing JSON input', () => {
  const out = [];
  const p = createTestProtocol((s) => out.push(s));
  assert.throws(
    () => p.push(`NOOK_TEST_FAILURE {${privateText}\n`),
    (e) => {
      assertPrivate(e.message);
      return true;
    },
  );
  assert.throws(() => p.finish());
  assertPrivate(out);
  assert.equal(decode(out.at(-1)).protocol_valid, false);
});
test('fragmented and coalesced records preserve exact final classifications', () => {
  const out = [];
  const p = createTestProtocol((s) => out.push(s));
  const file = 'account-security.integration.test.ts';
  const wire =
    line('FILE_START', { file }) +
    line('FILE_RESULT', { file, status: 'completed', ...result }) +
    line('FILE_COMPLETE', { file });
  for (let i = 0; i < wire.length; i += 3) p.push(wire.slice(i, i + 3));
  assert.throws(() => p.finish());
  const finals = out.filter((s) => s.startsWith('NOOK_TEST_FILE_RESULT ')).map(decode);
  assert.equal(finals.length, FILE_COUNT);
  assert.equal(finals[0].completionConfirmed, true);
  assert.equal(finals[1].status, 'not_started');
});

function greenWire() {
  return names
    .map((n) => {
      const file = `${n}.integration.test.ts`;
      return (
        line('FILE_START', { file }) +
        line('FILE_RESULT', { file, status: 'completed', ...result }) +
        line('FILE_COMPLETE', { file })
      );
    })
    .join('');
}
for (const mode of [
  'green',
  'missing',
  'contradictory',
  'failed',
  'nonzero',
  'no events',
  'signal',
  'reporter crash',
  'test crash',
  'timeout',
  'heartbeat',
  'overflow',
  'uncertain',
]) {
  test(`parent plus supervisor failure injection: ${mode}`, async () => {
    const output = [];
    const abort = new AbortController();
    const child = new EventEmitter();
    child.pid = 887766;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let failure;
    let stopped = false;
    const launch = () => {
      setTimeout(() => {
        child.stderr.write(privateText);
        if (mode === 'green' || mode === 'nonzero') child.stdout.write(greenWire());
        if (mode === 'failed')
          child.stdout.write(
            line('FILE_START', { file: 'account-security.integration.test.ts' }) +
              line('FILE_RESULT', {
                file: 'account-security.integration.test.ts',
                status: 'failed',
                ...result,
                passed: 0,
                failed: 1,
              }) +
              line('FILE_COMPLETE', { file: 'account-security.integration.test.ts' }),
          );
        if (mode === 'contradictory')
          child.stdout.write(
            line('FILE_START', { file: 'account-security.integration.test.ts' }) +
              line('FILE_RESULT', {
                file: 'account-security.integration.test.ts',
                status: 'completed',
                ...result,
                tests: 100,
              }),
          );
        if (mode === 'reporter crash')
          child.stdout.write('NOOK_TEST_INVALID ' + privateText + '\n');
        if (mode === 'overflow') child.stderr.write('x'.repeat(40000));
        if (mode === 'heartbeat') abort.abort('heartbeat_loss');
        if (!['timeout', 'heartbeat', 'overflow', 'contradictory', 'reporter crash'].includes(mode))
          child.emit(
            'close',
            ['nonzero', 'no events', 'failed', 'test crash'].includes(mode) ? 1 : 0,
            mode === 'signal' ? 'SIGTERM' : null,
          );
      }, 0);
      return child;
    };
    try {
      await withTestProtocol(
        (onOutput) =>
          supervise(
            'synthetic',
            [],
            {},
            {
              onOutput,
              launch,
              identity: 'integration_tests',
              signal: abort.signal,
              timeout: 25,
              closeTimeout: 10,
              maxBytes: 30000,
              stop: async () => {
                stopped = true;
                if (mode === 'uncertain') {
                  const e = new Error(privateText);
                  e.terminationUncertain = true;
                  throw e;
                }
                child.emit('close', null, 'SIGKILL');
              },
            },
          ),
        (s) => output.push(s),
      );
    } catch (e) {
      failure = e;
    }
    assert.equal(Boolean(failure), mode !== 'green');
    assert.equal(stopped, true);
    if (failure) {
      assertPrivate(safeError(failure));
      if (mode === 'nonzero') assert.equal(safeError(failure).exitCode, 1);
    }
    if (mode === 'uncertain') assert.equal(failure.terminationUncertain, true);
    if (mode === 'timeout') assert.equal(safeError(failure).timeout, true);
    if (mode === 'heartbeat') assert.equal(safeError(failure).heartbeatLost, true);
    if (mode === 'overflow') assert.equal(safeError(failure).outputOverflow, true);
    assertPrivate(output);
  });
}
for (const cleanupFails of [false, true])
  test(`reporter failure attempts cleanup (cleanup failure=${cleanupFails})`, async () => {
    const calls = [];
    const op = (name) => async () => {
      calls.push(name);
    };
    const stages = {
      preflight: op('preflight'),
      lock: { acquire: op('lock'), assertHeld() {}, release: op('release') },
      deploy: op('deploy'),
      ledger: op('ledger'),
      schema: op('schema'),
      grants: op('grants'),
      privileges: op('privileges'),
      fixtures: op('fixtures'),
      tests: async () => {
        calls.push('tests');
        await withTestProtocol(
          async () => {},
          () => {},
        );
      },
      cleanup: async () => {
        calls.push('cleanup');
        if (cleanupFails) throw new Error(privateText);
      },
    };
    await assert.rejects(runG6BStages(stages));
    assert.deepEqual(calls.slice(-3), ['fixtures', 'tests', 'cleanup']);
  });

test('actual Node multi-file pass, failure, cancellation, crash and never-started accounting', async () => {
  const { writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = await prepareReporterFixture('completion');
  const scripts = [
    "test('private name',()=>{});",
    "test('private name',()=>{});",
    `test('private name',()=>{assert.equal(${JSON.stringify(privateText)},'other');});test('private second',()=>{throw new Error(${JSON.stringify(privateText)});});`,
    "test('private cancelled',{ timeout: 25 },()=>new Promise(()=>{}));",
    'process.exit(7);',
  ];
  try {
    const paths = scripts.map((body, i) => {
      const path = cliPathFor(`${names[i]}.integration.test.ts`);
      writeFileSync(
        join(dir, path),
        `import { test } from 'node:test';import assert from 'node:assert/strict';${body}`,
      );
      return path;
    });
    const child = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-concurrency=1',
        '--test-reporter=./scripts/ci/integration-test-reporter.js',
        ...paths,
      ],
      { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 },
    );
    assert.equal(child.status, 1);
    const out = [];
    const protocol = createTestProtocol((s) => out.push(s));
    protocol.push(child.stdout);
    assert.throws(() => protocol.finish());
    const finals = out.filter((s) => s.startsWith('NOOK_TEST_FILE_RESULT ')).map(decode);
    assert.equal(finals.length, FILE_COUNT);
    assert.equal(finals[0].passed, 1);
    assert.equal(finals[1].passed, 1);
    assert.equal(finals[2].failed, 2);
    assert.equal(finals[3].cancelled, 1);
    assert.equal(finals[4].status, 'incomplete');
    assert.equal(finals[4].countsKnown, false);
    assert.equal(finals[5].status, 'not_started');
    const summary = decode(out.at(-1));
    assert.equal(summary.files_not_started, FILE_COUNT - 5);
    assert.equal(summary.cancelled, 1);
    assert.equal(summary.passed, 2);
    assertPrivate(child.stdout);
    assertPrivate(out);
    assert.ok(out.some((s) => s.includes('ASSERTION_LOCATION_UNKNOWN')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reporter and parent retain a safe assertion source while excluding every sensitive field', async () => {
  const error = new assert.AssertionError({
    message: privateText,
    actual: privateText,
    expected: privateText,
  });
  error.stack = `AssertionError: ${privateText}\n    at ${repo + validSource}:48:7`;
  Object.assign(error, { request: privateText, response: privateText, environment: privateText });
  const emitted = await reportEvents([
    { type: 'test:stdout', data: { file: eventFile, message: privateText } },
    { type: 'test:stderr', data: { file: eventFile, message: privateText } },
    {
      type: 'test:fail',
      data: { file: eventFile, name: privateText, details: { error: { cause: error } } },
    },
    {
      type: 'test:summary',
      data: {
        file: eventFile,
        success: false,
        counts: { tests: 1, failed: 1, passed: 0, cancelled: 0, skipped: 0, todo: 0 },
      },
    },
  ]);
  const out = [];
  const p = createTestProtocol((s) => out.push(s));
  for (const chunk of emitted) p.push(chunk);
  assert.throws(() => p.finish());
  const info = decode(out.find((s) => s.startsWith('NOOK_TEST_FAILURE ')));
  assert.equal(info.source, validSource);
  assert.equal(info.line, 48);
  assert.equal(info.column, 7);
  assert.equal(info.index, 1);
  assert.equal(info.diagnostic, 'ASSERTION_LOCATION_FOUND');
  assertPrivate(emitted);
  assertPrivate(out);
});
test('reporter retains a local native frame but parent rejects traversal source fields', async () => {
  const emitted = await reportEvents([
    {
      type: 'test:fail',
      data: {
        file: eventFile,
        details: {
          error: {
            name: 'AssertionError',
            code: 'ERR_ASSERTION',
            stack: `Error\n    at file://${repo + validSource}:2:1`,
          },
        },
      },
    },
  ]);
  assert.equal(decode(emitted[1]).source, validSource);
  const out = [];
  const p = createTestProtocol((s) => out.push(s));
  p.push(line('FILE_START', { file: 'account-security.integration.test.ts' }));
  p.push(
    line('FAILURE', {
      file: 'account-security.integration.test.ts',
      index: 1,
      name: 'AssertionError',
      code: 'ERR_ASSERTION',
      diagnostic: privateText,
      source: 'apps/api/test/integration/../integration/booking.integration.test.ts',
      line: 2,
      column: 1,
      stack: privateText,
    }),
  );
  assert.equal(decode(out.at(-1)).source, 'unknown');
  assertPrivate(out);
});

test('a validated summary retains known counts when completion is interrupted', () => {
  const out = [];
  const p = createTestProtocol((s) => out.push(s));
  const file = 'account-security.integration.test.ts';
  p.push(line('FILE_START', { file }));
  p.push(
    line('FILE_RESULT', {
      file,
      status: 'failed',
      tests: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      todo: 0,
      cancelled: 0,
    }),
  );
  assert.throws(() => p.finish());
  const final = decode(out.find((s) => s.startsWith('NOOK_TEST_FILE_RESULT ')));
  assert.equal(final.status, 'incomplete');
  assert.equal(final.failed, 1);
  assert.equal(final.countsKnown, true);
  assert.equal(final.completionConfirmed, false);
  assert.equal(decode(out.at(-1)).counts_complete, false);
});

// Focused corrections: natural Node frames and exact FileTest event semantics.
import { verifyIdentityFacts } from './g6b-preflight.js';
test('natural repository ESM assertion retains its source through reporter and parent', async () => {
  let cause;
  try {
    verifyIdentityFacts({});
  } catch (error) {
    cause = error;
  }
  assert.ok(cause.stack.includes('file://'));
  const emitted = await reportEvents([
    { type: 'test:fail', data: { file: eventFile, details: { error: { cause } } } },
  ]);
  const out = [];
  const p = createTestProtocol((s) => out.push(s));
  for (const s of emitted) p.push(s);
  const failure = decode(out.at(-1));
  assert.equal(failure.source, 'scripts/ci/g6b-preflight.js');
  assert.equal(failure.diagnostic, 'ASSERTION_LOCATION_FOUND');
  assert.equal(failure.name, 'AssertionError');
  assert.ok(failure.line > 0);
  assert.ok(!out.join('').includes(cause.stack));
});
for (const url of [
  'file://remote.invalid' + repo + validSource,
  'file://localhost' + repo + validSource,
  'file://user:password@host' + repo + validSource,
  'file://' + repo + validSource + '?private=value',
  'file://' + repo + validSource + '#private',
  'file:///private/outside.ts',
  'file://' + repo + 'apps/api/test/integration/../integration/booking.integration.test.ts',
  'file://' + repo + 'apps/api/test/integration/%2e%2e/integration/booking.integration.test.ts',
  'file://' + repo + 'apps\\api\\test\\integration\\booking.integration.test.ts',
  'file://%invalid',
])
  test(`unsafe native stack URL remains unknown (${url.indexOf('?') >= 0 ? 'query' : url.length})`, () => {
    assert.equal(
      safeError({ name: 'AssertionError', stack: `Error\n    at ${url}:9:2` }).source,
      'unknown',
    );
  });
test('queue and nested dequeue cannot launch a file', async () => {
  const file = eventFile;
  async function* events() {
    yield {
      type: 'test:enqueue',
      data: { file, name: cliPathFor(file), nesting: 0, parentId: 0, type: 'test' },
    };
    yield {
      type: 'test:dequeue',
      data: { file, name: file, nesting: 0, parentId: 0, type: 'test', entryFile: file },
    };
    yield {
      type: 'test:dequeue',
      data: { file, name: file, nesting: 1, parentId: 1, type: 'test' },
    };
  }
  const out = [];
  for await (const s of reporter(events())) out.push(s);
  assert.deepEqual(out, []);
});

async function runOutcomeFixture(body) {
  const { writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = await prepareReporterFixture('outcomes');
  try {
    const paths = names.map((name, index) => {
      const path = cliPathFor(`${name}.integration.test.ts`);
      writeFileSync(
        join(dir, path),
        `import {test,describe,before,after,it} from 'node:test';import assert from 'node:assert/strict';import {verifyIdentityFacts} from ${JSON.stringify(new URL('./g6b-preflight.js', import.meta.url).href)};${index === 0 ? body : "test('pass',()=>{});"}`,
      );
      return path;
    });
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--test',
        '--test-concurrency=1',
        '--test-reporter=./scripts/ci/integration-test-reporter.js',
        ...paths,
      ],
      { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 15000 },
    );
    assert.equal(child.error, undefined);
    const out = [];
    const protocol = createTestProtocol((s) => out.push(s));
    protocol.push(child.stdout);
    let finalError;
    try {
      protocol.finish();
    } catch (error) {
      finalError = error;
    }
    assertPrivate(out);
    return { code: child.status, out, finalError };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
for (const hook of ['before', 'after'])
  test(`real Node suite ${hook} assertion retains hook_failure without extra leaf counts`, async () => {
    const r = await runOutcomeFixture(
      `describe('private group',()=>{${hook}(()=>verifyIdentityFacts({}));it('private child',()=>{});});`,
    );
    assert.equal(r.code, 1);
    assert.ok(r.finalError);
    const hooks = r.out
      .filter((s) => s.startsWith('NOOK_TEST_FAILURE '))
      .map(decode)
      .filter((d) => d.kind === 'hook_failure');
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].name, 'AssertionError');
    assert.equal(hooks[0].source, 'scripts/ci/g6b-preflight.js');
    const first = r.out.filter((s) => s.startsWith('NOOK_TEST_FILE_RESULT ')).map(decode)[0];
    assert.equal(first.tests, 1); // The hook/suite does not add a leaf test.
    assert.equal(first.status, 'failed');
    const indices = r.out
      .filter((s) => s.startsWith('NOOK_TEST_FAILURE '))
      .map(decode)
      .map((d) => d.index);
    assert.deepEqual(
      indices,
      indices.map((_, i) => i + 1),
    );
  });
test('real throwing TODO remains TODO and a complete otherwise green suite is accepted', async () => {
  const r = await runOutcomeFixture(
    `test('private todo',{todo:true},()=>assert.fail(${JSON.stringify(privateText)}));test('pass',()=>{});`,
  );
  assert.equal(r.code, 0);
  assert.equal(r.finalError, undefined);
  assert.equal(r.out.filter((s) => s.startsWith('NOOK_TEST_FAILURE ')).length, 0);
  const first = r.out.filter((s) => s.startsWith('NOOK_TEST_FILE_RESULT ')).map(decode)[0];
  assert.equal(first.todo, 1);
  assert.equal(first.todoFailures, 1);
  assert.equal(first.failed, 0);
  assert.equal(first.failures, 0);
  const summary = decode(r.out.at(-1));
  assert.equal(summary.tests, FILE_COUNT + 1);
  assert.equal(summary.passed, FILE_COUNT);
  assert.equal(summary.todo, 1);
  assert.equal(summary.todo_failures, 1);
});
test('real ordinary assertion remains a hard failure with ordinal one', async () => {
  const r = await runOutcomeFixture(
    `test('private failure',()=>verifyIdentityFacts({}));test('pass',()=>{});`,
  );
  assert.equal(r.code, 1);
  assert.ok(r.finalError);
  const failures = r.out.filter((s) => s.startsWith('NOOK_TEST_FAILURE ')).map(decode);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].index, 1);
  assert.equal(failures[0].kind, 'test_failure');
  const summary = decode(r.out.at(-1));
  assert.equal(summary.failed, 1);
  assert.equal(summary.todo_failures, 0);
});

test('real file launch interrupted during module import is incomplete, never not_started', async () => {
  const { writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const dir = await prepareReporterFixture('interruption');
  try {
    const first = cliPathFor('account-security.integration.test.ts');
    const second = cliPathFor('auth.integration.test.ts');
    writeFileSync(
      join(dir, first),
      `setInterval(()=>{},1000);console.log('NOOK_IMPORT_PHASE_PROBE');await new Promise(()=>{});`,
    );
    writeFileSync(join(dir, second), `import {test} from 'node:test';test('never runs',()=>{});`);
    const wrapper = join(dir, 'reporter.mjs');
    writeFileSync(
      wrapper,
      `import reporter from ${JSON.stringify(join(dir, 'scripts/ci/integration-test-reporter.js'))};export default async function* (events){async function* observed(){let testStarted=false;for await(const e of events){if(e.type==='test:start')testStarted=true;if(e.type==='test:stdout'&&e.data.message.trim()==='NOOK_IMPORT_PHASE_PROBE'){process.stderr.write(testStarted?'PROBE_WRONG_ORDER':'PROBE_IMPORT_BEFORE_TEST');process.kill(process.pid,'SIGTERM');await new Promise(()=>{});}yield e;}}yield* reporter(observed());}`,
    );
    let importBeforeTest = false;
    const out = [];
    await assert.rejects(
      withTestProtocol(
        (onOutput) =>
          supervise(
            process.execPath,
            ['--test', '--test-concurrency=1', '--test-reporter=' + wrapper, first, second],
            { cwd: dir, env: { PATH: process.env.PATH } },
            {
              onOutput,
              identity: 'integration_tests',
              timeout: 3000,
              launch: (exe, args, options) => {
                const child = spawn(exe, args, options);
                child.stderr.on('data', (chunk) => {
                  if (chunk.toString().includes('PROBE_IMPORT_BEFORE_TEST'))
                    importBeforeTest = true;
                });
                return child;
              },
            },
          ),
        (s) => out.push(s),
      ),
    );
    assert.equal(importBeforeTest, true); // Actual module execution preceded interruption.
    const firstResult = out.filter((s) => s.startsWith('NOOK_TEST_FILE_RESULT ')).map(decode)[0];
    assert.equal(firstResult.file, 'account-security.integration.test.ts');
    assert.equal(firstResult.status, 'incomplete');
    assert.equal(firstResult.countsKnown, false);
    assert.equal(Object.hasOwn(firstResult, 'tests'), false);
    const summary = decode(out.at(-1));
    assert.equal(summary.files_started, 1);
    assert.equal(summary.files_not_started, FILE_COUNT - 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const failing of [false, true])
  test(`hosted relative-path startup (ordinary failure=${failing})`, async () => {
    const { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { spawnSync } = await import('node:child_process');
    // Nest only the temporary synthetic tree under the existing installation so
    // --import tsx resolves normally, exactly as in hosted CI; no new dependencies.
    const dir = mkdtempSync(
      join(fileURLToPath(new URL('../../', import.meta.url)), '.nook-startup-'),
    );
    try {
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      mkdirSync(join(dir, 'scripts/ci'), { recursive: true });
      for (const name of ['integration-test-reporter.js', 'diagnostics.js', 'test-files.json'])
        copyFileSync(new URL(name, import.meta.url), join(dir, 'scripts/ci', name));
      mkdirSync(join(dir, 'apps/api/test/integration'), { recursive: true });
      const paths = names.map((name, i) => {
        const path = `apps/api/test/integration/${name}.integration.test.ts`;
        const body = failing && i === 0 ? `assert.fail(${JSON.stringify(privateText)})` : '';
        writeFileSync(
          join(dir, path),
          `import test from 'node:test';import assert from 'node:assert/strict';test('private synthetic',()=>{${body}});`,
        );
        return path;
      });
      const child = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--test',
          '--test-concurrency=1',
          '--test-reporter=./scripts/ci/integration-test-reporter.js',
          ...paths,
        ],
        {
          cwd: dir,
          env: { PATH: process.env.PATH, APP_ENV: 'test' },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
      assert.equal(child.error, undefined);
      // Before the correction both cases exit 7 with no FILE_START records.
      assert.equal(child.status, failing ? 1 : 0);
      assert.equal(child.signal, null);
      const output = [];
      const protocol = createTestProtocol((s) => output.push(s));
      protocol.push(child.stdout);
      if (failing) assert.throws(() => protocol.finish());
      else protocol.finish();
      const summary = decode(output.at(-1));
      assert.equal(summary.files_started, FILE_COUNT);
      assert.equal(summary.files_completed, FILE_COUNT);
      assert.equal(summary.files_not_started, 0);
      assert.equal(summary.tests, FILE_COUNT);
      assert.equal(summary.passed, failing ? FILE_COUNT - 1 : FILE_COUNT);
      assert.equal(summary.failed, failing ? 1 : 0);
      const failures = output.filter((s) => s.startsWith('NOOK_TEST_FAILURE ')).map(decode);
      assert.equal(failures.length, failing ? 1 : 0);
      if (failing) {
        assert.equal(failures[0].file, 'account-security.integration.test.ts');
        assert.equal(failures[0].index, 1);
        assert.equal(failures[0].name, 'AssertionError');
      }
      assertPrivate(child.stdout);
      assertPrivate(output);
      assert.ok(!child.stderr.includes('Test event before file launch'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

function cliPathFor(file) {
  return `apps/api/test/integration/${file.split('/').at(-1)}`;
}
async function prepareReporterFixture(label) {
  const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(repo, `.nook-${label}-`));
  mkdirSync(join(dir, 'scripts/ci'), { recursive: true });
  mkdirSync(join(dir, 'apps/api/test/integration'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  for (const file of ['integration-test-reporter.js', 'test-files.json'])
    copyFileSync(new URL(file, import.meta.url), join(dir, 'scripts/ci', file));
  // Use the real sanitizer against real repository sources used by hook probes.
  // The reporter itself computes its launch boundary from this fixture's root.
  writeFileSync(
    join(dir, 'scripts/ci/diagnostics.js'),
    `export {safeError,safeSourceLocation} from ${JSON.stringify(new URL('./diagnostics.js', import.meta.url).href)};`,
  );
  return dir;
}

function launchEvent(name, file, changes = {}) {
  return {
    type: 'test:dequeue',
    data: { name, file, nesting: 0, parentId: 0, type: 'test', ...changes },
  };
}
async function launchRecords(event) {
  const output = [];
  async function* events() {
    yield event;
  }
  for await (const record of reporter(events())) output.push(record);
  return output;
}
for (const name of names)
  test(`launch boundary accepts expected hosted path: ${name}`, async () => {
    const cli = `apps/api/test/integration/${name}.integration.test.ts`;
    const file = fileURLToPath(new URL('../../' + cli, import.meta.url));
    const out = await launchRecords(launchEvent(cli, file));
    assert.equal(out.length, 1);
    assert.equal(decode(out[0]).file, `${name}.integration.test.ts`);
  });
const approvedCli = 'apps/api/test/integration/account-security.integration.test.ts';
const approvedFile = fileURLToPath(new URL('../../' + approvedCli, import.meta.url));
for (const [label, name, file, extra] of [
  [
    'outside POSIX traversal',
    '../../../../tmp/outside/account-security.integration.test.ts',
    '/tmp/outside/account-security.integration.test.ts',
  ],
  ['traversal back inside root', '../nook/' + approvedCli, approvedFile],
  [
    'internal traversal',
    'apps/api/test/integration/../integration/account-security.integration.test.ts',
    approvedFile,
  ],
  [
    'Windows traversal',
    '..\\nook\\apps\\api\\test\\integration\\account-security.integration.test.ts',
    approvedFile,
  ],
  ['absolute name', approvedFile, approvedFile],
  ['URL name', 'file://' + approvedFile, approvedFile],
  [
    'Windows drive path',
    'C:\\apps\\api\\test\\integration\\account-security.integration.test.ts',
    approvedFile,
  ],
  [
    'matching basename in wrong directory',
    'other/account-security.integration.test.ts',
    repo + 'other/account-security.integration.test.ts',
  ],
  ['outside absolute file', approvedCli, '/tmp/outside/account-security.integration.test.ts'],
  [
    'wrong contained absolute file',
    approvedCli,
    repo + 'other/account-security.integration.test.ts',
  ],
  ['relative file', approvedCli, approvedCli],
  ['file URL', approvedCli, 'file://' + approvedFile],
  [
    'raw file traversal',
    approvedCli,
    repo + 'apps/api/test/integration/../integration/account-security.integration.test.ts',
  ],
  ['worker event', approvedCli, approvedFile, { entryFile: approvedFile }],
  ['nested event', approvedCli, approvedFile, { nesting: 1, parentId: 1 }],
  ['malformed name', null, approvedFile],
])
  test(`launch boundary rejects ${label}`, async () => {
    const out = await launchRecords(launchEvent(name, file, extra));
    assert.deepEqual(out, []);
    const parentOutput = [];
    const protocol = createTestProtocol((s) => parentOutput.push(s));
    assert.throws(() => protocol.finish());
    assert.equal(decode(parentOutput.at(-1)).files_started, 0);
    assert.equal(decode(parentOutput.at(-1)).files_not_started, FILE_COUNT);
  });
