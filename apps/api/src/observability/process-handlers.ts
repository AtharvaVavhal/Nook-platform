import { flushErrorReporter, reportError } from './error-reporter.js';
import { log } from './json-logger.js';
import { serializeError } from './redact.js';

/**
 * Last-resort handlers for errors that escape every request. Each is logged as one JSON line (so Railway shows it with
 * its severity) and then the process exits non-zero: continuing after an uncaught exception would run in an unknown
 * state, and Railway restarts a crashed service. Installed only by main.ts, never by tests.
 */
export function installProcessHandlers(): void {
  const crash = (kind: string, error: unknown) => {
    log.error(kind, { context: 'process', err: serializeError(error) });
    reportError(error, { status: 500 });
    // give stdout and the error reporter a moment to deliver, then exit
    void flushErrorReporter(2000).finally(() => setTimeout(() => process.exit(1), 100).unref());
  };
  process.on('uncaughtException', (error) => crash('uncaught exception', error));
  process.on('unhandledRejection', (reason) => crash('unhandled promise rejection', reason));
}
