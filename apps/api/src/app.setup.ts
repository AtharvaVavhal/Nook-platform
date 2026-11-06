import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { RuntimeConfig } from './config.js';
import { AllExceptionsFilter } from './observability/all-exceptions.filter.js';
import { httpLoggingMiddleware } from './observability/http-logging.js';
import { log } from './observability/json-logger.js';
import { REQUEST_ID_HEADER, requestIdMiddleware } from './observability/request-id.js';

export const API_PREFIX = 'api/v1';

/** Request headers the browser client may send cross-origin. Everything else is refused at the preflight. */
export const CORS_ALLOWED_HEADERS = ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'];
export const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * The HTTP-level configuration shared by the real server (main.ts) and the integration tests, so the tests
 * exercise exactly what production runs: proxy trust, security headers, credentialed CORS for one exact
 * origin, the API prefix and graceful shutdown.
 *
 * Browser model (API on its own host, web on another host of the same registrable domain):
 *  - the session and CSRF cookies are host-only on the API host (no `Domain`), HttpOnly, SameSite=Strict;
 *  - the web app gets the CSRF token from the body of GET /auth/csrf, keeps it in memory, and sends it in the
 *    X-CSRF-Token header with `credentials: 'include'`; the server compares it with the cookie;
 *  - CORS allows exactly WEB_ORIGIN with credentials, never `*`.
 */
export function configureApp(app: INestApplication, config: RuntimeConfig): void {
  // Logging first: structured JSON on stdout for Railway, one request id per request, one access-log line per request,
  // and a single exception filter so no error response ever carries internals.
  log.configure({
    level: config.logLevel,
    base: {
      env: config.appEnv,
      ...(process.env.RAILWAY_GIT_COMMIT_SHA
        ? { version: process.env.RAILWAY_GIT_COMMIT_SHA }
        : {}),
    },
  });
  app.useLogger(log);
  app.use(requestIdMiddleware);
  app.use(httpLoggingMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  if (config.trustProxyHops > 0) {
    // The express instance is reached through the platform adapter.
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
      'trust proxy',
      config.trustProxyHops,
    );
  }
  app.use(helmet());
  app.enableCors({
    // Exactly one origin, compared as a whole string. Anyone else gets no CORS headers at all (not even the
    // allowed origin echoed back), and the response varies by Origin so caches never mix the two.
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: string | false) => void,
    ) => callback(null, origin === config.webOrigin ? origin : false),
    credentials: true,
    methods: CORS_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    // the browser app may read the id of a failed call, to quote it when asking for help
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}
