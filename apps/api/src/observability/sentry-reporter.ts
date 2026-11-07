import * as Sentry from '@sentry/node';
import type { ErrorReporter } from './error-reporter.js';
import { redact, scrubString, serializeError } from './redact.js';

/**
 * Error reporting to Sentry, API only. Privacy rules (all enforced here and covered by tests):
 *
 *  - Sentry sees an error only when the exception filter or the crash handler reports it: unexpected failures, never
 *    4xx responses, never a log line.
 *  - The error is rebuilt before it is sent: name, a SCRUBBED message (connection-string passwords, e-mail addresses,
 *    phone numbers, tokens removed; Prisma errors reduced to their first line and code) and stack FRAMES only. The
 *    original error object, and anything attached to it, never reaches the SDK.
 *  - `sendDefaultPii` is off; no default integrations are installed, so no HTTP request data, bodies, headers,
 *    cookies, console output or breadcrumbs are collected; tracing and profiling are off; no OpenTelemetry setup.
 *  - The only context is: request id, HTTP method, route with ids replaced by ":id", status, and the user's id and the
 *    organisation id (opaque UUIDs). No e-mail, name, address or IP.
 *  - `beforeSend` and `beforeBreadcrumb` are a second line of defence: they strip request data, breadcrumbs, server
 *    name and anything not on the allow-list, and scrub every remaining string.
 */
export interface SentryReporterOptions {
  dsn: string;
  environment: string;
  release?: string | undefined;
  /** Test seam: replaces the network transport. */
  transport?: NonNullable<Parameters<typeof Sentry.init>[0]>['transport'];
}

const UUID_IN_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** `/api/v1/invoices/3f2b…` -> `/api/v1/invoices/:id`, so the same route groups into one issue. */
export function routeName(method: string | undefined, path: string | undefined): string {
  const route = (path ?? 'unknown').split('?')[0]!.replace(UUID_IN_PATH, ':id');
  return `${method ?? 'UNKNOWN'} ${route}`;
}

/** An error that carries only what is safe to send: its (scrubbed) name and message, and its stack frames. */
export function sanitizedError(error: unknown): Error {
  const info = serializeError(error);
  const safe = new Error(info.message);
  safe.name = info.name;
  safe.stack = [
    `${info.name}: ${info.message}`,
    ...(info.stack ?? []).map((frame) => `    ${frame}`),
  ].join('\n');
  return safe;
}

/** Final scrub applied to every event just before it leaves the process. */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  delete event.request;
  delete event.server_name;
  delete event.modules;
  event.breadcrumbs = [];
  const userId = event.user?.id;
  event.user = userId ? { id: String(userId) } : {};
  if (event.message) event.message = scrubString(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubString(exception.value);
  }
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
  if (event.contexts) {
    // keep runtime facts that help debugging; drop anything that could identify a person or a machine
    const { trace, runtime } = event.contexts as Record<string, unknown>;
    event.contexts = {
      ...(trace ? { trace } : {}),
      ...(runtime ? { runtime } : {}),
    } as typeof event.contexts;
  }
  return event;
}

export function initSentryReporter(
  options: SentryReporterOptions,
): ErrorReporter & { close(): Promise<boolean> } {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    ...(options.release ? { release: options.release } : {}),
    sendDefaultPii: false,
    defaultIntegrations: false,
    integrations: [],
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    sendClientReports: false,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: () => null,
    ...(options.transport ? { transport: options.transport } : {}),
  });

  return {
    capture(error, context) {
      Sentry.withScope((scope) => {
        scope.setLevel('error');
        scope.setTags({
          ...(context.requestId ? { requestId: context.requestId } : {}),
          ...(context.method ? { method: context.method } : {}),
          status: String(context.status),
          ...(context.organizationId ? { organizationId: context.organizationId } : {}),
        });
        scope.setTransactionName(routeName(context.method, context.path));
        if (context.userId) scope.setUser({ id: context.userId });
        Sentry.captureException(sanitizedError(error));
      });
    },
    flush: (timeoutMs) => Sentry.flush(timeoutMs),
    close: () => Sentry.close(2000),
  };
}
