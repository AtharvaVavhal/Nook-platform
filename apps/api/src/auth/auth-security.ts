import { createHash } from 'node:crypto';

export type ThrottleScope = 'IDENTIFIER' | 'ADDRESS' | 'PASSWORD';

/** Failures allowed inside the window before the key is locked, per scope. */
export const THROTTLE_LIMITS: Record<ThrottleScope, number> = {
  IDENTIFIER: 5, // one account: 5 wrong passwords
  ADDRESS: 20, // one source address: 20 wrong passwords across any accounts
  PASSWORD: 5, // one signed-in user: 5 wrong "current password" attempts
};
export const THROTTLE_WINDOW_MINUTES = 15;
export const THROTTLE_LOCK_MINUTES = 15;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Keys are hashed so the throttle table never holds an e-mail address or an IP address. */
export function throttleKeyHash(scope: ThrottleScope, value: string): string {
  return createHash('sha256').update(`${scope}:${value}`, 'utf8').digest('hex');
}

/** A short, non-reversible tag for audit entries about identifiers that match no account. */
export function identifierTag(identifier: string): string {
  return createHash('sha256').update(`identifier:${identifier}`, 'utf8').digest('hex').slice(0, 12);
}

export type PasswordProblem =
  | 'TYPE'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'SAME_AS_CURRENT'
  | 'SAME_AS_IDENTIFIER';

/** The whole password policy: length, and not trivially the old password or the sign-in e-mail. */
export function checkNewPassword(
  next: unknown,
  current: string,
  loginIdentifier: string,
): PasswordProblem | null {
  if (typeof next !== 'string') return 'TYPE';
  if (next.length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (next.length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';
  if (next === current) return 'SAME_AS_CURRENT';
  if (next.toLowerCase() === loginIdentifier.toLowerCase()) return 'SAME_AS_IDENTIFIER';
  return null;
}

export function describePasswordProblem(problem: PasswordProblem): string {
  switch (problem) {
    case 'TOO_SHORT':
      return `The new password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    case 'TOO_LONG':
      return `The new password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
    case 'SAME_AS_CURRENT':
      return 'The new password must be different from the current one.';
    case 'SAME_AS_IDENTIFIER':
      return 'The new password cannot be your e-mail address.';
    default:
      return 'The new password must be text.';
  }
}
