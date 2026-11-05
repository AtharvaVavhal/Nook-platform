/**
 * Where unexpected errors are reported besides the log. The default does nothing. An error tracker (Sentry) would be
 * one small adapter that implements this interface and is installed with setErrorReporter(); see
 * docs/ops/OBSERVABILITY.md for the proposal, which needs approval before any dependency is added.
 */
export interface ErrorReportContext {
  requestId?: string | undefined;
  method?: string | undefined;
  path?: string | undefined;
  status: number;
  userId?: string | undefined;
  organizationId?: string | undefined;
}

export interface ErrorReporter {
  capture(error: unknown, context: ErrorReportContext): void;
  /** Wait (at most `timeoutMs`) for queued reports to be delivered, e.g. before the process exits. */
  flush?(timeoutMs: number): Promise<boolean>;
}

let reporter: ErrorReporter = { capture: () => {} };

export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

export function reportError(error: unknown, context: ErrorReportContext): void {
  try {
    reporter.capture(error, context);
  } catch {
    // a failing reporter must never turn an error response into a crash
  }
}

/** Delivers anything still queued. Never throws and never waits longer than `timeoutMs`. */
export async function flushErrorReporter(timeoutMs = 2000): Promise<void> {
  try {
    await reporter.flush?.(timeoutMs);
  } catch {
    // nothing more can be done
  }
}
