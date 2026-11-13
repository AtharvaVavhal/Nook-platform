import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { HttpRequestLike, HttpResponseLike } from './http-types.js';
import { reportError } from './error-reporter.js';
import { log } from './json-logger.js';
import { currentRequestId } from './request-context.js';
import { serializeError } from './redact.js';
import { classifyFailure } from '../common/tx-errors.js';

/**
 * The single place where an exception becomes a response.
 *
 *  - An HttpException (validation, 401/403/404/409, ...) was written on purpose with a client-safe message: its body is
 *    passed through unchanged, so every existing client contract and test keeps working. Such responses are logged by
 *    the access log, not here.
 *  - Anything else (a bug, a Prisma or driver error, a failed dependency) is an INTERNAL error. The client gets only
 *    `{ statusCode: 500, message: 'Internal server error', requestId }`: no message, no stack, no query, no class name.
 *    The full detail, redacted, goes to the log and to the error reporter, tagged with the same requestId.
 *  - An HttpException with a 5xx status gets the same treatment, because a 5xx message is not meant for the client,
 *    except the deliberate 503 object of the health check, which is kept (plus the request id).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<HttpResponseLike>();
    const req = http.getRequest<HttpRequestLike>();
    const requestId = currentRequestId() ?? req.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: unknown;
    let internal = true;

    // A lock timeout or deadlock is a certain rollback: nothing committed, so it is reported as a retryable 409 (not a 500).
    // Other ambiguous database failures stay internal errors, because an ordinary write has no receipt to resolve them.
    const failure = classifyFailure(exception);
    if (
      !(exception instanceof HttpException) &&
      (failure === 'LOCK_TIMEOUT' || failure === 'DEADLOCK')
    ) {
      internal = false;
      status = HttpStatus.CONFLICT;
      body = {
        statusCode: 409,
        code: 'RETRY_REQUIRED',
        message: 'The system is busy. Nothing was changed; please try again.',
        ...(requestId ? { requestId } : {}),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (status < 500) {
        internal = false;
        body = typeof response === 'string' ? { statusCode: status, message: response } : response;
      } else if (
        status === 503 &&
        response &&
        typeof response === 'object' &&
        !Array.isArray(response)
      ) {
        // The health endpoint answers 503 on purpose with a small, safe object ({ status: 'degraded', dependency });
        // monitors read it, so it is kept, with the request id added.
        internal = false;
        body = { ...(response as object), ...(requestId ? { requestId } : {}) };
      }
    }

    if (internal) {
      body = {
        statusCode: status >= 500 ? status : 500,
        message: status === 503 ? 'Service unavailable' : 'Internal server error',
        ...(requestId ? { requestId } : {}),
      };
      status = status >= 500 ? status : 500;
      const path = (req.originalUrl ?? '').split('?')[0];
      log.error('unhandled exception', {
        context: 'exception-filter',
        method: req.method,
        path,
        status,
        err: serializeError(exception),
        ...(req.auth?.userId ? { userId: req.auth.userId } : {}),
        ...(req.auth?.organizationId ? { organizationId: req.auth.organizationId } : {}),
      });
      reportError(exception, {
        requestId,
        method: req.method,
        path,
        status,
        userId: req.auth?.userId,
        organizationId: req.auth?.organizationId,
      });
    }

    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json(body);
  }
}
