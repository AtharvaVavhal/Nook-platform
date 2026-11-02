// Sign-in client for the existing session API. The session lives in an HttpOnly cookie set by the
// server, so nothing about the session is ever stored by the browser application itself.
import { API_BASE, csrfToken, notifyUnauthorized } from '../apiConfig';
import type { AuthErrorCode } from './authHelpers';

export interface AuthUser {
  id: string;
  displayName: string;
  organization: { id: string; name: string };
  role: string;
  /** True while a temporary password is in use: the user must choose their own. */
  passwordChangeRequired: boolean;
}

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    readonly retryAfterSeconds = 0,
  ) {
    super(message);
  }
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, { credentials: 'include', ...init });
  } catch {
    throw new AuthError('NETWORK', 'network');
  }
}

export const authApi = {
  /** The signed-in user, or null when there is no valid session. */
  async me(): Promise<AuthUser | null> {
    const response = await send('/auth/me', { method: 'GET' });
    if (response.status === 401) return null;
    if (!response.ok) throw new AuthError('UNKNOWN', `status ${response.status}`);
    const body = (await response.json()) as { data: { user: AuthUser } };
    return body.data.user;
  },

  async login(email: string, password: string): Promise<AuthUser> {
    const response = await send('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (response.status === 401) throw new AuthError('INVALID_CREDENTIALS', 'invalid');
    if (response.status === 429) throw new AuthError('RATE_LIMITED', 'rate limited');
    if (!response.ok) throw new AuthError('UNKNOWN', `status ${response.status}`);
    const body = (await response.json()) as { data: { user: AuthUser } };
    return body.data.user;
  },

  /** Ends the session on the server. An already-expired session counts as signed out. */
  async logout(): Promise<void> {
    const response = await send('/auth/logout', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken() },
    });
    if (response.ok || response.status === 401) return;
    throw new AuthError('UNKNOWN', `status ${response.status}`);
  },

  /** Change the signed-in user's own password. Other sessions of this user are ended by the server. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const response = await send('/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (response.ok) return;
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
      retryAfterSeconds?: number;
    };
    if (response.status === 401) {
      notifyUnauthorized();
      throw new PasswordChangeError(
        'SESSION_ENDED',
        'Your session has ended. Please sign in again.',
      );
    }
    if (response.status === 429) {
      throw new PasswordChangeError('RATE_LIMITED', '', body.retryAfterSeconds ?? 900);
    }
    if (body.code === 'CURRENT_PASSWORD_INVALID') {
      throw new PasswordChangeError('CURRENT_INVALID', 'The current password is incorrect.');
    }
    if (body.code === 'NEW_PASSWORD_REJECTED') {
      throw new PasswordChangeError(
        'NEW_REJECTED',
        body.message ?? 'That new password is not allowed.',
      );
    }
    throw new PasswordChangeError('UNKNOWN', 'Could not change the password. Please try again.');
  },
};

export type PasswordChangeCode =
  | 'CURRENT_INVALID'
  | 'NEW_REJECTED'
  | 'RATE_LIMITED'
  | 'SESSION_ENDED'
  | 'UNKNOWN';

export class PasswordChangeError extends Error {
  constructor(
    readonly code: PasswordChangeCode,
    message: string,
    readonly retryAfterSeconds = 0,
  ) {
    super(message);
  }
}
