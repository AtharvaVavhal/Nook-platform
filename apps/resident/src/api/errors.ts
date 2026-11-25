/**
 * Every failure the UI can meet, reduced to a small set of kinds. The API answers authentication failures generically on
 * purpose (a wrong code and an expired code look the same, and a suspended, revoked, inactive or archived resident only sees
 * "not signed in"), so the UI never claims to know more than the API says.
 */
export type ApiErrorKind =
  | 'network' // the request never reached the API (offline, DNS, CORS, server down)
  | 'unauthorized' // 401: no session, ended session, or portal access not available
  | 'forbidden' // 403
  | 'notFound' // 404 (a record that is missing or not yours; or the portal is switched off)
  | 'rateLimited' // 429
  | 'badRequest' // 400
  | 'server' // 5xx
  | 'unexpected'; // anything else, including a response that is not JSON

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    kind: ApiErrorKind,
    status: number,
    code: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(`${kind}${code ? `:${code}` : ''}`);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function classify(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimited';
  if (status === 400) return 'badRequest';
  if (status >= 500) return 'server';
  return 'unexpected';
}

export function errorFromResponse(status: number, body: unknown): ApiError {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = typeof record.code === 'string' ? record.code : null;
  const retry =
    typeof record.retryAfterSeconds === 'number' && Number.isFinite(record.retryAfterSeconds)
      ? record.retryAfterSeconds
      : null;
  return new ApiError(classify(status), status, code, retry);
}

export function asApiError(value: unknown): ApiError {
  return value instanceof ApiError ? value : new ApiError('unexpected', 0);
}
