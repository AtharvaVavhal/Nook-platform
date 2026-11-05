import { IntegrationGuardError } from './guard.js';

/**
 * The suite-wide lock, as a small state machine over an injected connection and clock. Nothing here imports
 * `pg` or touches a timer directly, so retry timing and lifecycle behaviour are unit-tested with mocks.
 *
 * Design:
 *  - One dedicated connection takes a session-level advisory lock and keeps it for the life of the process.
 *  - Acquisition retries on that same connection (no extra connections) for a bounded time, because the
 *    previous run's backend may need a moment to disappear after its process exits.
 *  - After acquisition a heartbeat pings the connection. If the connection errors, ends, or stops answering,
 *    the lock is treated as LOST: the loss handler runs once (in production it terminates the test process)
 *    and `assertHeld()` throws from then on. There is deliberately no reconnect: a new connection would be a
 *    new session that does not hold the lock, so the only safe response to loss is to stop.
 *  - `release()` is intentional shutdown and never reports a loss.
 */

export interface LockConnection {
  /** Runs pg_try_advisory_lock once; true only if this session now holds the lock. */
  tryAdvisoryLock(): Promise<boolean>;
  /** A trivial round trip, used as a heartbeat. Rejects if the connection is unusable. */
  ping(): Promise<void>;
  /** Registers a listener for connection errors and unexpected closure. */
  onLost(listener: (reason: string) => void): void;
  /** Ends the connection (which releases the lock). Safe to call more than once. */
  close(): Promise<void>;
}

export interface LockTimer {
  stop(): void;
}

export interface LockClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Calls `fn` every `ms` until stopped. Must not keep the process alive. */
  every(fn: () => void, ms: number): LockTimer;
}

export interface RetryPolicy {
  /** Wait between attempts. */
  intervalMs: number;
  /** Total time allowed to acquire before giving up. */
  maxWaitMs: number;
}

/**
 * 250 ms between attempts for at most 15 s: at most 61 attempts on one connection. A previous run's backend
 * normally disappears within milliseconds of its process exiting; 15 s is far beyond that yet short enough
 * that a genuinely concurrent run fails promptly.
 */
export const DEFAULT_RETRY: RetryPolicy = { intervalMs: 250, maxWaitMs: 15_000 };

export interface HeartbeatPolicy {
  intervalMs: number;
  /** Consecutive ticks that may pass with the previous ping still unanswered before the lock is declared lost. */
  maxUnansweredTicks: number;
}

export const DEFAULT_HEARTBEAT: HeartbeatPolicy = { intervalMs: 5_000, maxUnansweredTicks: 3 };

export interface AcquireResult {
  acquired: boolean;
  attempts: number;
}

/**
 * Calls `tryOnce` until it returns true or the deadline passes. Never reports success without a true result.
 * The last attempt is the first one that would start after `maxWaitMs - intervalMs` has elapsed.
 */
export async function acquireWithRetry(
  tryOnce: () => Promise<boolean>,
  policy: RetryPolicy,
  clock: Pick<LockClock, 'now' | 'sleep'>,
): Promise<AcquireResult> {
  if (!(policy.intervalMs > 0) || !(policy.maxWaitMs >= 0)) {
    throw new RangeError('retry policy needs a positive interval and a non-negative maximum wait');
  }
  const start = clock.now();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    if (await tryOnce()) return { acquired: true, attempts };
    if (clock.now() - start + policy.intervalMs > policy.maxWaitMs) {
      return { acquired: false, attempts };
    }
    await clock.sleep(policy.intervalMs);
  }
}

export type LockState = 'idle' | 'acquiring' | 'held' | 'lost' | 'released';

export class SuiteLock {
  private currentState: LockState = 'idle';
  private timer: LockTimer | undefined;
  private pingInFlight = false;
  private unansweredTicks = 0;

  constructor(
    private readonly connection: LockConnection,
    private readonly clock: LockClock,
    /** Runs once if the lock is lost after it was acquired. In production this ends the process. */
    private readonly onLost: (reason: string) => void,
    private readonly retry: RetryPolicy = DEFAULT_RETRY,
    private readonly heartbeat: HeartbeatPolicy = DEFAULT_HEARTBEAT,
  ) {}

  get state(): LockState {
    return this.currentState;
  }

  /** Acquires the lock or throws. On any failure the connection is closed and nothing is held. */
  async acquire(): Promise<void> {
    if (this.currentState !== 'idle') {
      throw new IntegrationGuardError(['the suite lock can only be acquired once per process']);
    }
    this.currentState = 'acquiring';
    this.connection.onLost((reason) => this.handleLost(reason));

    let result: AcquireResult;
    try {
      result = await acquireWithRetry(
        () => this.connection.tryAdvisoryLock(),
        this.retry,
        this.clock,
      );
    } catch {
      await this.failAcquire();
      throw new IntegrationGuardError(['the suite lock could not be requested from the database']);
    }
    if (!result.acquired) {
      await this.failAcquire();
      throw new IntegrationGuardError([
        `another integration run holds the suite lock on this database (gave up after ${result.attempts} attempts over ${this.retry.maxWaitMs} ms)`,
      ]);
    }
    // The connection may have dropped while the last attempt was in flight.
    if (this.currentState !== 'acquiring') {
      await this.failAcquire();
      throw new IntegrationGuardError([
        'the suite lock connection was lost while acquiring the lock',
      ]);
    }
    this.currentState = 'held';
    this.timer = this.clock.every(() => this.tick(), this.heartbeat.intervalMs);
  }

  /** Throws unless the lock is currently held. Database helpers call this before handing out a client. */
  assertHeld(): void {
    if (this.currentState !== 'held') {
      throw new IntegrationGuardError([
        `the integration suite lock is not held (${this.currentState})`,
      ]);
    }
  }

  /** Intentional shutdown. Idempotent. Never reports a loss. */
  async release(): Promise<void> {
    if (this.currentState === 'released') return;
    this.currentState = 'released';
    this.timer?.stop();
    try {
      await this.connection.close();
    } catch {
      /* the connection is gone either way; closing it is what releases the lock */
    }
  }

  private async failAcquire(): Promise<void> {
    this.currentState = 'released';
    try {
      await this.connection.close();
    } catch {
      /* already closed */
    }
  }

  private tick(): void {
    if (this.currentState !== 'held') return;
    if (this.pingInFlight) {
      this.unansweredTicks += 1;
      if (this.unansweredTicks >= this.heartbeat.maxUnansweredTicks) {
        this.handleLost('heartbeat unanswered');
      }
      return;
    }
    this.pingInFlight = true;
    this.connection.ping().then(
      () => {
        this.pingInFlight = false;
        this.unansweredTicks = 0;
      },
      () => {
        this.pingInFlight = false;
        this.handleLost('heartbeat failed');
      },
    );
  }

  private handleLost(reason: string): void {
    if (this.currentState === 'acquiring') {
      // Detected before the lock was ever reported as held; acquire() notices and fails.
      this.currentState = 'lost';
      return;
    }
    if (this.currentState !== 'held') return; // intentional release, or already lost
    this.currentState = 'lost';
    this.timer?.stop();
    this.onLost(reason);
  }
}
