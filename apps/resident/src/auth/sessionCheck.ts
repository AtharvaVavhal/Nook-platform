import { ApiError, asApiError } from '../api/errors.js';

/**
 * Whether the portal really has a session. After a code is accepted the server has set a session cookie, but "signed in" is only
 * ever whatever the very next read of the profile says: a browser that drops the cookie makes that read fail with 401, and that
 * must be reported, not silently treated as a success.
 */
export type SessionCheck =
  | { kind: 'signedIn' }
  | { kind: 'noSession' }
  | { kind: 'unavailable'; error: ApiError };

/** `null` means the profile loaded. A 401 means there is no usable session; any other failure means we could not find out. */
export function sessionCheckFromError(error: unknown): SessionCheck {
  if (error === null) return { kind: 'signedIn' };
  const e = error instanceof ApiError ? error : asApiError(error);
  return e.kind === 'unauthorized' ? { kind: 'noSession' } : { kind: 'unavailable', error: e };
}
