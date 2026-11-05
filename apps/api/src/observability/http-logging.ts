import type { HttpRequestLike, HttpResponseLike, NextFn } from './http-types.js';
import { log } from './json-logger.js';

const QUIET_PATH = /\/health(\/|$)/;

/**
 * One line per request, written when the response finishes (so guard refusals, CORS refusals and exception-filter
 * responses are all included). It records WHAT was asked and how it went, never the content: no body, no cookie, no
 * header, no query VALUES (only the names of the parameters, because a search term can be a resident's name), no
 * address. Who asked is the user and organisation ids from the session, when there is one.
 */
export function httpLoggingMiddleware(
  req: HttpRequestLike,
  res: HttpResponseLike,
  next: NextFn,
): void {
  const started = process.hrtime.bigint();
  let done = false;

  const finish = (aborted: boolean) => {
    if (done) return;
    done = true;
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const status = res.statusCode;
    const auth = req.auth;
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
    const queryKeys = Object.keys(req.query ?? {}).slice(0, 20);
    const route = req.route?.path;
    const fields = {
      method: req.method,
      path,
      ...(route ? { route } : {}),
      status,
      durationMs: Math.round(durationMs * 10) / 10,
      ...(res.getHeader('content-length')
        ? { contentLength: Number(res.getHeader('content-length')) }
        : {}),
      ...(queryKeys.length ? { queryKeys } : {}),
      ...(auth?.userId ? { userId: auth.userId } : {}),
      ...(auth?.organizationId ? { organizationId: auth.organizationId } : {}),
      ...(auth?.role ? { role: auth.role } : {}),
    };
    if (aborted) {
      log.warn('request aborted by the client', { ...fields, context: 'http' });
    } else if (status >= 500) {
      log.error('request failed', { ...fields, context: 'http' });
    } else if (status >= 400) {
      log.warn('request rejected', { ...fields, context: 'http' });
    } else if (QUIET_PATH.test(path)) {
      log.debug('health check', { ...fields, context: 'http' });
    } else {
      log.info('request completed', { ...fields, context: 'http' });
    }
  };

  res.on('finish', () => finish(false));
  res.on('close', () => finish(!res.writableEnded));
  next();
}
