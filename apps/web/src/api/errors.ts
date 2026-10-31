import type { ApiErrorPayload } from './types';

/**
 * Base API error representing non-2xx HTTP responses.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]> | undefined;

  constructor(status: number, message: string, code = 'API_ERROR', details?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * 401 Unauthorized: Session is missing, expired, or invalid.
 */
export class UnauthorizedError extends ApiError {
  constructor(message = 'Session expired or unauthenticated.') {
    super(401, message, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

/**
 * 403 Forbidden: User does not hold the required permission.
 */
export class ForbiddenError extends ApiError {
  readonly requiredPermission?: string | undefined;

  constructor(message = 'You do not have permission to perform this action.', permission?: string) {
    super(403, message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
    this.requiredPermission = permission;
  }
}

/**
 * 404 Not Found: Entity does not exist, or cross-org boundary prevents discovery.
 */
export class NotFoundError extends ApiError {
  constructor(message = 'The requested resource was not found.') {
    super(404, message, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/**
 * 409 Conflict: E.g., bed was taken between selection and submission.
 */
export class ConflictError extends ApiError {
  constructor(message = 'The state of the resource changed. Please refresh and try again.') {
    super(409, message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

/**
 * 422 Unprocessable Entity - RULE_NOT_CONFIGURED.
 * Non-negotiable rule 5: No business rule is guessed.
 * Names the unconfigured rule plainly without offering workarounds.
 */
export class RuleNotConfiguredError extends ApiError {
  readonly rule: string;

  constructor(rule: string, message?: string) {
    const formatted = message
      ? message.includes(rule)
        ? message
        : `${message} (Rule: ${rule})`
      : `Business rule "${rule}" has not been configured by the property administrator.`;
    super(422, formatted, 'RULE_NOT_CONFIGURED');
    this.name = 'RuleNotConfiguredError';
    this.rule = rule;
  }
}

/**
 * Network failure or connection drop.
 */
export class NetworkError extends Error {
  constructor(message = 'Unable to connect to the server. Please check your network.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Request timed out.
 */
export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms.`);
    this.name = 'TimeoutError';
  }
}

/**
 * Factory to map HTTP status codes and payloads to typed error instances.
 */
export function createErrorFromResponse(status: number, payload?: ApiErrorPayload | null): ApiError {
  const code = payload?.error?.code ?? `HTTP_${status}`;
  const message = payload?.error?.message ?? `Request failed with status ${status}.`;
  const details = payload?.error?.details;

  if (status === 401) {
    return new UnauthorizedError(message);
  }
  if (status === 403) {
    return new ForbiddenError(message);
  }
  if (status === 404) {
    return new NotFoundError(message);
  }
  if (status === 409) {
    return new ConflictError(message);
  }
  if (status === 422 && (code === 'RULE_NOT_CONFIGURED' || payload?.error?.rule)) {
    const rule = payload?.error?.rule || 'UNSPECIFIED_RULE';
    return new RuleNotConfiguredError(rule, message);
  }

  return new ApiError(status, message, code, details);
}
