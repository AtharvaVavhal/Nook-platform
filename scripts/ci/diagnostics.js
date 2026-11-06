import { realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = new Set([
  'scripts/ci/integration.js',
  'scripts/ci/g6b-migration.js',
  'scripts/ci/g6b-preflight.js',
  'scripts/ci/migration-ledger.js',
  'scripts/ci/diagnostics.js',
  'apps/api/test/integration/helpers/guard.ts',
  'apps/api/test/integration/helpers/suite-lock.ts',
]);
const STAGES = new Set([
  'hosted_environment_validation',
  'postgres_service_readiness',
  'bootstrap_validation',
  'role_provisioning',
  'database_provisioning',
  'database_identity_preflight',
  'empty_schema_preflight',
  'migration_lock_acquisition',
  'toolchain_resolution',
  'prisma_deployment',
  'ledger_verification',
  'schema_verification',
  'runtime_grants',
  'runtime_privilege_verification',
  'migration_lock_release',
  'fixture_execution',
  'integration_test_execution',
  'postrun_verification',
  'cleanup',
]);
const CHILDREN = new Set(['prisma', 'fixtures', 'integration_tests']);
const SIGNALS = new Set([
  'SIGINT',
  'SIGTERM',
  'SIGKILL',
  'SIGABRT',
  'SIGSEGV',
  'SIGPIPE',
  'SIGHUP',
]);
const metadata = new WeakMap();
const CODES = new Set([
  'ERR_ASSERTION',
  'ENOENT',
  'EACCES',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
]);

// No message, actual, expected, raw stack, SQL or process argument is ever serialized.
export function safeError(error) {
  const name = [
    'AssertionError',
    'IntegrationGuardError',
    'Error',
    'TypeError',
    'RangeError',
  ].includes(error?.name)
    ? error.name
    : 'UnknownError';
  const code =
    CODES.has(error?.code) || (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code))
      ? error.code
      : 'unknown';
  let source = 'unknown';
  let line = null;
  let column = null;
  if (typeof error?.stack === 'string') {
    // Skip the first line, which contains the raw message. Accept only actual stack-frame syntax.
    for (const frame of error.stack.split('\n').slice(1)) {
      const match = /^\s+at (?:[^()\r\n]+ \()?((?:file:\/\/)?\/[^()\r\n]+):(\d+):(\d+)\)?$/.exec(
        frame,
      );
      if (!match) continue;
      try {
        const path = match[1].startsWith('file://') ? fileURLToPath(match[1]) : match[1];
        const rel = relative(ROOT, path);
        if (
          !FILES.has(rel) ||
          realpathSync(path) !== resolve(ROOT, rel) ||
          !statSync(path).isFile()
        )
          continue;
        const row = Number(match[2]);
        const col = Number(match[3]);
        if (!Number.isSafeInteger(row) || !Number.isSafeInteger(col) || row <= 0 || col <= 0)
          continue;
        source = rel;
        line = row;
        column = col;
        break;
      } catch {
        /* An unverifiable frame is never printed. */
      }
    }
  }
  const child = error && typeof error === 'object' ? metadata.get(error) : undefined;
  const diagnostic = child
    ? 'CHILD_PROCESS_FAILURE'
    : code === 'ERR_ASSERTION' || name === 'AssertionError'
      ? source === 'unknown'
        ? 'ASSERTION_LOCATION_UNKNOWN'
        : 'ASSERTION_LOCATION_FOUND'
      : name === 'IntegrationGuardError'
        ? 'INTEGRATION_GUARD_FAILURE'
        : /^[0-9A-Z]{5}$/.test(code)
          ? 'DATABASE_DRIVER_ERROR'
          : 'UNKNOWN_ERROR';
  return { name, code, diagnostic, source, line, column, ...(child ?? {}) };
}

export function childFacts(identity, info = {}) {
  return {
    child: CHILDREN.has(identity) ? identity : 'unknown',
    errorCode: CODES.has(info.errorCode) ? info.errorCode : 'unknown',
    exitCode:
      Number.isInteger(info.exitCode) && info.exitCode >= 0 && info.exitCode <= 255
        ? info.exitCode
        : null,
    signal: SIGNALS.has(info.signal) ? info.signal : null,
    requestedSignal: SIGNALS.has(info.requestedSignal) ? info.requestedSignal : null,
    timeout: info.timeout === true,
    heartbeatLost: info.heartbeatLost === true,
    outputOverflow: info.outputOverflow === true,
    terminationConfirmed: info.terminationConfirmed === true,
  };
}
export function attachChildFailure(error, identity, info) {
  metadata.set(error, childFacts(identity, info));
  return error;
}

export function createDiagnostics(write = (line) => console.log(line)) {
  let active = null;
  let lastSuccessful = 'none';
  let failure = null;
  let cleanupCompleted = false;
  let sequence = 0;
  let lastSuccessfulSequence = 0;
  const emit = (event, fields) => write(`${event} ${JSON.stringify(fields)}`);
  const begin = (stage) => {
    if (!STAGES.has(stage) || active !== null)
      throw new Error('Invalid diagnostic stage transition');
    active = stage;
    sequence++;
    emit('NOOK_CI_STAGE_START', { stage, sequence, lastSuccessful, lastSuccessfulSequence });
  };
  const complete = (stage) => {
    lastSuccessful = stage;
    lastSuccessfulSequence = sequence;
    if (stage === 'cleanup') cleanupCompleted = true;
    emit('NOOK_CI_STAGE_COMPLETE', { stage, sequence });
    active = null;
  };
  const failed = (stage, error) => {
    const info = { stage, sequence, lastSuccessful, lastSuccessfulSequence, ...safeError(error) };
    failure ??= info;
    emit('NOOK_CI_STAGE_FAILED', info);
    active = null;
  };
  return {
    async run(stage, operation) {
      begin(stage);
      try {
        const value = await operation();
        complete(stage);
        return value;
      } catch (error) {
        failed(stage, error);
        throw error;
      }
    },
    runSync(stage, operation) {
      begin(stage);
      try {
        const value = operation();
        complete(stage);
        return value;
      } catch (error) {
        failed(stage, error);
        throw error;
      }
    },
    child(event, identity, info) {
      if (!['START', 'COMPLETE', 'FAILED'].includes(event)) throw new Error('Invalid child event');
      emit(`NOOK_CI_CHILD_${event}`, { stage: active ?? 'unknown', ...childFacts(identity, info) });
    },
    report(error) {
      failure ??= {
        stage: active ?? 'unknown',
        lastSuccessful,
        lastSuccessfulSequence,
        ...safeError(error),
      };
      emit('NOOK_CI_FAILURE', {
        ...(failure ?? { stage: active ?? 'unknown', lastSuccessful, ...safeError(error) }),
        cleanupCompleted,
      });
    },
  };
}
