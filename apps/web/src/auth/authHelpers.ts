/** Pure helpers for the sign-in form, kept free of React so they can be unit tested. */

export interface LoginFieldErrors {
  email?: string;
  password?: string;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

export function validateLogin(email: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const trimmed = email.trim();
  if (!trimmed) errors.email = 'Enter your email address.';
  else if (!EMAIL_SHAPE.test(trimmed)) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

export type AuthErrorCode = 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'NETWORK' | 'UNKNOWN';

/** Messages never reveal whether the email or the password was wrong. */
export function describeAuthError(code: AuthErrorCode): string {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'The email or password is incorrect.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment and try again.';
    case 'NETWORK':
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong while signing in. Please try again.';
  }
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordChangeErrors {
  current?: string;
  next?: string;
  confirm?: string;
}

/** Mirrors the server policy so mistakes are caught before a request; the server remains the authority. */
export function validatePasswordChange(
  current: string,
  next: string,
  confirm: string,
  loginIdentifier = '',
): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {};
  if (!current) errors.current = 'Enter your current password.';
  if (next.length < PASSWORD_MIN_LENGTH)
    errors.next = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  else if (next.length > PASSWORD_MAX_LENGTH)
    errors.next = `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  else if (next === current)
    errors.next = 'The new password must be different from the current one.';
  else if (loginIdentifier && next.toLowerCase() === loginIdentifier.toLowerCase())
    errors.next = 'The new password cannot be your e-mail address.';
  if (!errors.next && confirm !== next) errors.confirm = 'The two new passwords do not match.';
  return errors;
}

export function describeLockout(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}
