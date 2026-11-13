// What the user is told when the API refuses a request for access reasons. The API answers the global
// permission layer with a bare `{ code }` (no message), so without this the screens showed "Request failed (403)".
// This is wording only: the API stays the authority on who may do what.

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.';

/** A friendly message for a 401 or an access-related 403, or null when the status/code is not one of those. */
export function accessFailureMessage(status: number, code?: string): string | null {
  if (status === 401) return SESSION_ENDED_MESSAGE;
  if (status !== 403) return null;
  switch (code) {
    case 'INSUFFICIENT_ROLE':
      return 'Your role does not allow this action. Ask an owner of your organization if you need access.';
    case 'ROUTE_NOT_DECLARED':
      return 'This action is not available.';
    case 'PASSWORD_CHANGE_REQUIRED':
      return 'Choose a new password before continuing.';
    default:
      return null;
  }
}

/** 403 codes that mean "the request was rejected by a browser-security check", not "you may not do this". */
export function isSecurityRefusal(status: number, code?: string): boolean {
  return status === 403 && (!code || code === 'INVALID_CSRF_TOKEN' || code === 'INVALID_ORIGIN');
}

export function isPasswordChangeRequired(status: number, code?: string): boolean {
  return status === 403 && code === 'PASSWORD_CHANGE_REQUIRED';
}
