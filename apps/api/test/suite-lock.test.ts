import assert from 'node:assert/strict';
import test from 'node:test';
import { IntegrationGuardError } from './integration/helpers/guard.js';
import {
  DEFAULT_HEARTBEAT,
  DEFAULT_RETRY,
  SuiteLock,
  acquireWithRetry,
  type LockClock,
  type LockConnection,
} from './integration/helpers/suite-lock.js';

// The suite lock is exercised with a mock connection and a fake clock: no PostgreSQL, no real timers, no sleeps.

/** A deterministic clock. `sleep` advances time instead of waiting; `tick` fires the heartbeat by hand. */
class FakeClock implements LockClock {
  time = 0;
  sleeps: number[] = [];
  private callbacks: { fn: () => void; active: boolean }[] = [];
  now() {
    return this.time;
  }
  async sleep(ms: number) {
    this.sleeps.push(ms);
    this.time += ms;
  }
  every(fn: () => void) {
    const entry = { fn, active: true };
    this.callbacks.push(entry);
    return { stop: () => (entry.active = false) };
  }
  tick() {
    for (const entry of this.callbacks) if (entry.active) entry.fn();
  }
  get timersRunning() {
    return this.callbacks.filter((c) => c.active).length;
  }
}

class MockConnection implements LockConnection {
  attempts = 0;
  closed = 0;
  pings = 0;
  listeners: ((reason: string) => void)[] = [];
  /** Results per attempt; after the list is exhausted the last value repeats. */
  results: (boolean | Error)[] = [true];
  pingBehaviour: 'ok' | 'fail' | 'hang' = 'ok';
  pendingPing: { resolve: () => void } | undefined;
  async tryAdvisoryLock() {
    const result = this.results[Math.min(this.attempts, this.results.length - 1)]!;
    this.attempts += 1;
    if (result instanceof Error) throw result;
    return result;
  }
  async ping() {
    this.pings += 1;
    if (this.pingBehaviour === 'fail') throw new Error('socket closed');
    if (this.pingBehaviour === 'hang') {
      await new Promise<void>((resolve) => (this.pendingPing = { resolve }));
    }
  }
  onLost(listener: (reason: string) => void) {
    this.listeners.push(listener);
  }
  async close() {
    this.closed += 1;
  }
  /** Simulates the driver reporting an error or an unexpected end. */
  drop(reason = 'connection closed') {
    for (const listener of this.listeners) listener(reason);
  }
}

const policy = { intervalMs: 100, maxWaitMs: 1_000 };

function build(connection = new MockConnection(), clock = new FakeClock(), retry = policy) {
  const lost: string[] = [];
  const lock = new SuiteLock(connection, clock, (reason) => lost.push(reason), retry, {
    intervalMs: 5_000,
    maxUnansweredTicks: 3,
  });
  return { connection, clock, lock, lost };
}

// ------------------------------------------------------------------ F4: bounded retry

test('the documented retry policy is a short interval with a hard ceiling', () => {
  assert.deepEqual(DEFAULT_RETRY, { intervalMs: 250, maxWaitMs: 15_000 });
  assert.deepEqual(DEFAULT_HEARTBEAT, { intervalMs: 5_000, maxUnansweredTicks: 3 });
  // at most floor(15000 / 250) + 1 attempts, all on one connection
  assert.equal(Math.floor(DEFAULT_RETRY.maxWaitMs / DEFAULT_RETRY.intervalMs) + 1, 61);
});

test('retry: success on the first attempt never sleeps', async () => {
  const clock = new FakeClock();
  const result = await acquireWithRetry(async () => true, policy, clock);
  assert.deepEqual(result, { acquired: true, attempts: 1 });
  assert.deepEqual(clock.sleeps, []);
});

test('retry: a transient refusal is retried at the fixed interval until it succeeds', async () => {
  const clock = new FakeClock();
  const outcomes = [false, false, true];
  const result = await acquireWithRetry(async () => outcomes.shift()!, policy, clock);
  assert.deepEqual(result, { acquired: true, attempts: 3 });
  assert.deepEqual(clock.sleeps, [100, 100]);
});

test('retry: it gives up at the deadline and reports failure, never success', async () => {
  const clock = new FakeClock();
  let calls = 0;
  const result = await acquireWithRetry(
    async () => {
      calls += 1;
      return false;
    },
    policy,
    clock,
  );
  assert.equal(result.acquired, false);
  assert.equal(calls, result.attempts);
  // 1000 ms at 100 ms: attempts at t=0,100,...,900 and one last at t=1000 is refused by the deadline rule
  assert.ok(result.attempts <= Math.floor(policy.maxWaitMs / policy.intervalMs) + 1);
  assert.ok(clock.time <= policy.maxWaitMs, 'never waits past the maximum');
});

test('retry: a zero maximum wait makes exactly one attempt', async () => {
  const clock = new FakeClock();
  const result = await acquireWithRetry(
    async () => false,
    { intervalMs: 100, maxWaitMs: 0 },
    clock,
  );
  assert.deepEqual(result, { acquired: false, attempts: 1 });
  assert.deepEqual(clock.sleeps, []);
});

test('retry: nonsense policies are rejected instead of looping forever', async () => {
  const clock = new FakeClock();
  for (const bad of [
    { intervalMs: 0, maxWaitMs: 100 },
    { intervalMs: -1, maxWaitMs: 100 },
    { intervalMs: Number.NaN, maxWaitMs: 100 },
    { intervalMs: 10, maxWaitMs: -1 },
  ]) {
    await assert.rejects(
      acquireWithRetry(async () => false, bad, clock),
      RangeError,
    );
  }
});

test('retry: an error from the connection propagates instead of being treated as "not acquired"', async () => {
  const clock = new FakeClock();
  await assert.rejects(
    acquireWithRetry(
      async () => {
        throw new Error('boom');
      },
      policy,
      clock,
    ),
    /boom/,
  );
});

// ------------------------------------------------------------------ acquisition

test('acquire: holds the lock after a transient refusal, on ONE connection, and starts the heartbeat', async () => {
  const { connection, clock, lock } = build();
  connection.results = [false, false, true];
  await lock.acquire();
  assert.equal(lock.state, 'held');
  assert.equal(connection.attempts, 3, 'retries reuse the same connection');
  assert.equal(connection.closed, 0);
  assert.equal(clock.timersRunning, 1);
  assert.doesNotThrow(() => lock.assertHeld());
});

test('acquire: when the deadline passes it fails with a safe error, closes the connection and holds nothing', async () => {
  const { connection, clock, lock } = build();
  connection.results = [false];
  await assert.rejects(lock.acquire(), (error) => {
    assert.ok(error instanceof IntegrationGuardError);
    assert.match(error.message, /another integration run holds the suite lock/);
    assert.match(error.message, /gave up after \d+ attempts/);
    return true;
  });
  assert.equal(connection.closed, 1);
  assert.equal(clock.timersRunning, 0, 'no heartbeat for a lock that was never held');
  assert.throws(() => lock.assertHeld(), IntegrationGuardError);
  assert.notEqual(lock.state, 'held');
});

test('acquire: a database error during acquisition is reported safely and nothing is held', async () => {
  const { connection, lock } = build();
  connection.results = [new Error('password authentication failed for user "x"')];
  await assert.rejects(lock.acquire(), (error) => {
    assert.ok(error instanceof IntegrationGuardError);
    assert.ok(!error.message.includes('password'), 'the driver message is not echoed');
    return true;
  });
  assert.equal(connection.closed, 1);
  assert.throws(() => lock.assertHeld(), IntegrationGuardError);
});

test('acquire: a connection lost while the last attempt was in flight is a failure, not a held lock', async () => {
  const connection = new MockConnection();
  const original = connection.tryAdvisoryLock.bind(connection);
  connection.tryAdvisoryLock = async () => {
    const result = await original();
    connection.drop('connection closed'); // dropped right after the server said yes
    return result;
  };
  const { lock, lost } = build(connection);
  await assert.rejects(lock.acquire(), IntegrationGuardError);
  assert.equal(lost.length, 0, 'the loss handler is only for locks that had been reported held');
  assert.throws(() => lock.assertHeld(), IntegrationGuardError);
  assert.equal(connection.closed, 1);
});

test('acquire: can only happen once per process', async () => {
  const { lock } = build();
  await lock.acquire();
  await assert.rejects(lock.acquire(), /only be acquired once/);
});

// ------------------------------------------------------------------ F3: loss detection

test('lost: an unexpected disconnect after acquisition runs the loss handler exactly once and blocks further use', async () => {
  const { connection, lock, lost, clock } = build();
  await lock.acquire();
  connection.drop('connection closed');
  connection.drop('connection closed'); // a second event must not run the handler again
  assert.deepEqual(lost, ['connection closed']);
  assert.equal(lock.state, 'lost');
  assert.throws(() => lock.assertHeld(), /not held \(lost\)/);
  assert.equal(clock.timersRunning, 0, 'the heartbeat stops once the lock is lost');
});

test('lost: a connection error event is treated the same way, with the driver reason passed through', async () => {
  const { connection, lock, lost } = build();
  await lock.acquire();
  connection.drop('connection error (ECONNRESET)');
  assert.deepEqual(lost, ['connection error (ECONNRESET)']);
  assert.equal(lock.state, 'lost');
});

test('lost: a failed heartbeat declares the lock lost', async () => {
  const { connection, lock, lost, clock } = build();
  await lock.acquire();
  clock.tick(); // healthy
  await Promise.resolve();
  assert.equal(lock.state, 'held');
  connection.pingBehaviour = 'fail';
  clock.tick();
  await new Promise((resolve) => setImmediate(resolve)); // let the rejected ping settle
  assert.deepEqual(lost, ['heartbeat failed']);
  assert.equal(lock.state, 'lost');
});

test('lost: a heartbeat that never answers is declared lost after the allowed number of unanswered ticks', async () => {
  const { connection, lock, lost, clock } = build();
  connection.pingBehaviour = 'hang';
  await lock.acquire();
  clock.tick(); // ping starts and hangs
  clock.tick(); // unanswered 1
  clock.tick(); // unanswered 2
  assert.equal(lost.length, 0);
  assert.equal(lock.state, 'held');
  clock.tick(); // unanswered 3
  assert.deepEqual(lost, ['heartbeat unanswered']);
  assert.equal(lock.state, 'lost');
  assert.equal(connection.pings, 1, 'one ping is outstanding; no pile of requests is queued');
});

test('lost: a late answer resets the unanswered counter', async () => {
  const { connection, lock, lost, clock } = build();
  connection.pingBehaviour = 'hang';
  await lock.acquire();
  clock.tick();
  clock.tick();
  clock.tick(); // two unanswered ticks
  connection.pendingPing!.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  connection.pingBehaviour = 'ok';
  clock.tick(); // a fresh ping succeeds
  await new Promise((resolve) => setImmediate(resolve));
  clock.tick();
  clock.tick();
  assert.equal(lost.length, 0);
  assert.equal(lock.state, 'held');
});

test('lost: there is no reconnect; once lost the lock can never be re-acquired by this object', async () => {
  const { connection, lock } = build();
  await lock.acquire();
  connection.drop();
  assert.equal(lock.state, 'lost');
  await assert.rejects(lock.acquire(), /only be acquired once/);
  assert.throws(() => lock.assertHeld(), IntegrationGuardError);
});

// ------------------------------------------------------------------ release

test('release: intentional shutdown closes the connection, stops the heartbeat and never reports a loss', async () => {
  const { connection, lock, lost, clock } = build();
  await lock.acquire();
  const closing = lock.release();
  connection.drop('connection closed'); // the driver reports the close it was asked for
  await closing;
  assert.equal(connection.closed, 1);
  assert.equal(lock.state, 'released');
  assert.equal(lost.length, 0, 'a requested close is not a loss');
  assert.equal(clock.timersRunning, 0);
  assert.throws(() => lock.assertHeld(), IntegrationGuardError);
});

test('release: is idempotent and survives a connection that fails to close', async () => {
  const { connection, lock } = build();
  await lock.acquire();
  connection.close = async () => {
    connection.closed += 1;
    throw new Error('already closed');
  };
  await lock.release();
  await lock.release();
  assert.equal(connection.closed, 1, 'closed once, never twice');
  assert.equal(lock.state, 'released');
});

test('release: also works on a lock that was lost, and on one that was never acquired', async () => {
  const lostCase = build();
  await lostCase.lock.acquire();
  lostCase.connection.drop();
  await lostCase.lock.release();
  assert.equal(lostCase.connection.closed, 1);

  const idleCase = build();
  await idleCase.lock.release();
  assert.equal(idleCase.lock.state, 'released');
});

test('assertHeld: refuses before acquisition', () => {
  const { lock } = build();
  assert.throws(() => lock.assertHeld(), /not held \(idle\)/);
});

test('the lock module imports no database driver and does not touch real timers', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(
    new URL('./integration/helpers/suite-lock.ts', import.meta.url),
    'utf8',
  );
  assert.ok(!/from 'pg'|require\('pg'\)/.test(source), 'no pg import');
  assert.ok(!/\bsetTimeout\(|\bsetInterval\(/.test(source), 'timers are injected');
});
