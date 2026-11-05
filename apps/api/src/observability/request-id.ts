import { randomUUID } from 'node:crypto';
import type { HttpRequestLike, HttpResponseLike, NextFn } from './http-types.js';
import { runWithRequest } from './request-context.js';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Only a well-formed UUID from the caller is kept (a reverse proxy or a client tracing a call may send one). Anything
 * else, including anything long, with spaces, newlines or other characters that could forge or split a log line, is
 * replaced by a fresh id. The id is also what is stored on audit events, so it must be a UUID.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function chooseRequestId(incoming: unknown): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return typeof candidate === 'string' && UUID.test(candidate)
    ? candidate.toLowerCase()
    : randomUUID();
}

/**
 * First middleware in the chain: every response (200, 401, 404, a CORS refusal, a 500) carries X-Request-Id, and the id
 * is available to the logger, the exception filter and the audit trail for the rest of the request.
 */
export function requestIdMiddleware(
  req: HttpRequestLike,
  res: HttpResponseLike,
  next: NextFn,
): void {
  const requestId = chooseRequestId(req.headers['x-request-id']);
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithRequest({ requestId }, () => next());
}
