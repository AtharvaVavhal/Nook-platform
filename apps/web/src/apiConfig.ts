import { createCsrfClient } from './csrf';

/**
 * Where the API lives. In production this is the API's own address (VITE_API_BASE=https://api.trynook.in/api/v1);
 * in development it is the same-origin path that the Vite dev server proxies to the local API.
 */
export const API_BASE: string = import.meta.env?.VITE_API_BASE || '/api/v1';

/** The one CSRF client every API module shares (token in memory, sent in the X-CSRF-Token header). */
export const csrf = createCsrfClient(API_BASE, (input, init) => fetch(input, init));

/** Fired by the API clients when an authenticated request is refused with 401 (session ended). */
export const UNAUTHORIZED_EVENT = 'nook:unauthorized';

export function notifyUnauthorized(): void {
  // The session is gone, so the token that belonged to it is too.
  csrf.clear();
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}
