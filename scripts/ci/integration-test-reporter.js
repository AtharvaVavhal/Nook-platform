import { readFileSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { safeError, safeSourceLocation } from './diagnostics.js';

export const files = JSON.parse(
  readFileSync(new URL('./test-files.json', import.meta.url)),
).full.map((name) => `${name}.integration.test.ts`);
const keys = ['tests', 'passed', 'failed', 'skipped', 'todo', 'cancelled'];
const record = (event, data) => `NOOK_TEST_${event} ${JSON.stringify(data)}\n`;
const counts = (value) => {
  if (!value || !keys.every((k) => Number.isSafeInteger(value[k]) && value[k] >= 0))
    throw new Error('Invalid test counts');
  const result = Object.fromEntries(keys.map((k) => [k, value[k]]));
  if (keys.slice(1).reduce((n, k) => n + result[k], 0) !== result.tests)
    throw new Error('Contradictory test counts');
  return result;
};
export default async function* reporter(events) {
  const started = new Set();
  const ended = new Set();
  const failures = new Map();
  const todoFailures = new Map();
  for await (const { type, data: d } of events) {
    const file = typeof d.file === 'string' ? basename(d.file) : null;
    if (!files.includes(file)) continue;
    // The runner's FileTest dequeue precedes worker/module execution. Worker
    // suite/test dequeues carry entryFile and must not start another file.
    if (type === 'test:dequeue') {
      if (
        d.nesting === 0 &&
        d.parentId === 0 &&
        d.type === 'test' &&
        !Object.hasOwn(d, 'entryFile') &&
        d.name === d.file &&
        isAbsolute(d.file)
      ) {
        if (started.has(file)) throw new Error('Duplicate file launch');
        started.add(file);
        yield record('FILE_START', { file });
      }
      continue;
    }
    if (!['test:start', 'test:pass', 'test:fail', 'test:summary'].includes(type)) continue;
    if (!started.has(file)) throw new Error('Test event before file launch');
    if (type === 'test:fail' && d.details?.error?.failureType !== 'subtestsFailed') {
      // Node represents a throwing TODO as test:fail but counts it under TODO.
      if (d.todo === true || typeof d.todo === 'string') {
        todoFailures.set(file, (todoFailures.get(file) ?? 0) + 1);
      } else {
        const error = d.details?.error;
        const index = (failures.get(file) ?? 0) + 1;
        failures.set(file, index);
        yield record('FAILURE', {
          file,
          index,
          kind: error?.failureType === 'hookFailed' ? 'hook_failure' : 'test_failure',
          ...safeError(error?.cause ?? error),
        });
      }
    }
    if (type === 'test:summary') {
      if (typeof d.success !== 'boolean') throw new Error('Invalid test summary');
      if (ended.has(file)) throw new Error('Duplicate test summary');
      ended.add(file);
      yield record('FILE_RESULT', {
        file,
        status: d.success ? 'completed' : 'failed',
        failures: failures.get(file) ?? 0,
        todoFailures: todoFailures.get(file) ?? 0,
        ...counts(d.counts),
      });
      yield record('FILE_COMPLETE', { file });
    }
  }
}

// Rebuild every emitted object: arbitrary child fields are never relayed.
export function createTestProtocol(write) {
  let buffer = '';
  let current = null;
  let result = null;
  let next = 0;
  let failureIndex = 0;
  let invalid = false;
  let finished = false;
  const results = [];
  const emit = (event, data) => write(record(event, data).trimEnd());
  const consume = (line) => {
    if (!line.startsWith('NOOK_TEST_')) return;
    const match = /^NOOK_TEST_(FILE_START|FAILURE|FILE_RESULT|FILE_COMPLETE) (.*)$/.exec(line);
    if (!match) throw new Error('Invalid test protocol');
    const d = JSON.parse(match[2]);
    if (!files.includes(d.file)) throw new Error('Unknown test file');
    const event = match[1];
    if (event === 'FILE_START') {
      if (current || d.file !== files[next]) throw new Error('Invalid file order');
      current = d.file;
      failureIndex = 0;
      emit(event, { file: current });
    } else {
      if (d.file !== current) throw new Error('Invalid file transition');
      if (event === 'FAILURE') {
        if (result || d.index !== ++failureIndex) throw new Error('Invalid failure order');
        const kind = d.kind ?? 'test_failure';
        if (!['test_failure', 'hook_failure'].includes(kind))
          throw new Error('Invalid failure kind');
        const safe = safeError({ name: d.name, code: d.code });
        Object.assign(safe, safeSourceLocation(d.source, d.line, d.column));
        if (safe.code === 'ERR_ASSERTION' || safe.name === 'AssertionError')
          safe.diagnostic =
            safe.source === 'unknown' ? 'ASSERTION_LOCATION_UNKNOWN' : 'ASSERTION_LOCATION_FOUND';
        emit(event, {
          file: current,
          fileIndex: next + 1,
          index: failureIndex,
          kind,
          sourceFound: safe.source !== 'unknown',
          ...safe,
        });
      } else if (event === 'FILE_RESULT') {
        if (result || !['completed', 'failed'].includes(d.status))
          throw new Error('Duplicate result');
        result = {
          file: current,
          status: d.status,
          failures: failureIndex,
          countsKnown: true,
          completionConfirmed: false,
          ...counts(d),
          todoFailures: d.todoFailures ?? 0,
        };
        if (
          !Number.isSafeInteger(result.todoFailures) ||
          result.todoFailures < 0 ||
          result.todoFailures > result.todo
        )
          throw new Error('Invalid TODO failure count');
        if (d.failures !== undefined && d.failures !== failureIndex)
          throw new Error('Failure count mismatch');
        if (result.status === 'completed' && (result.failed || result.cancelled || failureIndex))
          throw new Error('False test success');
        // Final classification is emitted only after FILE_COMPLETE is validated.
      } else {
        if (!result) throw new Error('Missing result');
        result.completionConfirmed = true;
        results.push(result);
        emit('FILE_RESULT', result);
        emit(event, { file: current });
        current = null;
        result = null;
        next++;
      }
    }
  };
  return {
    push(chunk) {
      if (invalid || finished) throw new Error('Test protocol rejected');
      try {
        // Bound individual records, not a chunk containing many valid short records.
        const text = chunk.toString();
        for (let offset = 0; offset < text.length; offset += 4096) {
          buffer += text.slice(offset, offset + 4096);
          let end;
          while ((end = buffer.indexOf('\n')) !== -1) {
            if (end > 65536) throw new Error('Test record overflow');
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            consume(line);
          }
          if (buffer.length > 65536) throw new Error('Test record overflow');
        }
      } catch {
        invalid = true;
        throw new Error('Invalid test protocol');
      }
    },
    finish() {
      if (finished) throw new Error('Test protocol already finalized');
      finished = true;
      for (let i = next; i < files.length; i++) {
        emit('FILE_RESULT', {
          file: files[i],
          status: files[i] === current ? 'incomplete' : 'not_started',
          completionConfirmed: false,
          countsKnown: files[i] === current && Boolean(result) && !invalid,
          ...(files[i] === current && result && !invalid
            ? { ...counts(result), todoFailures: result.todoFailures }
            : {}),
          failures: files[i] === current ? failureIndex : 0,
        });
      }
      const totals = Object.fromEntries(
        keys.map((k) => [
          k,
          results.reduce((n, r) => n + r[k], 0) + (current && result && !invalid ? result[k] : 0),
        ]),
      );
      emit('SUITE_RESULT', {
        counts_complete: !invalid && next === files.length && !current && !buffer,
        protocol_valid: !invalid,
        files_started: next + (current ? 1 : 0),
        files_total: files.length,
        files_completed: results.length,
        files_failed: results.filter((r) => r.status === 'failed').length,
        files_incomplete: current ? 1 : 0,
        files_not_started: files.length - next - (current ? 1 : 0),
        ...totals,
        todo_failures:
          results.reduce((n, r) => n + r.todoFailures, 0) +
          (current && result && !invalid ? result.todoFailures : 0),
      });
      if (
        invalid ||
        buffer ||
        current ||
        next !== files.length ||
        results.some((r) => r.status !== 'completed')
      )
        throw new Error('Integration results incomplete or failed');
    },
  };
}

export async function withTestProtocol(operation, write) {
  const protocol = createTestProtocol(write);
  let error;
  try {
    await operation((chunk) => protocol.push(chunk));
  } catch (cause) {
    error = cause;
  }
  try {
    protocol.finish();
  } catch (cause) {
    error ??= cause;
  }
  if (error) throw error;
}
