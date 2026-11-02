/** Single source of truth for where the API lives and how writes are authenticated. */
export const API_BASE: string = import.meta.env.VITE_API_BASE || '/api/v1';

/** The double-submit CSRF token the server sets in the readable `nook_csrf` cookie. */
export function csrfToken(): string {
  const match = document.cookie.split('; ').find((c) => c.startsWith('nook_csrf='));
  return match ? decodeURIComponent(match.slice('nook_csrf='.length)) : '';
}

/** Fired by the API clients when an authenticated request is refused with 401 (session ended). */
export const UNAUTHORIZED_EVENT = 'nook:unauthorized';

export function notifyUnauthorized(): void {
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}
