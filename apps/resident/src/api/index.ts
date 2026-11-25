import { createApiClient } from './client.js';
import { createResidentApi } from './endpoints.js';

/**
 * Where the API lives. Production: VITE_API_BASE=https://api.trynook.in/api/v1 (a public address, not a secret).
 * Development: the same-origin path that the Vite dev server proxies to the local API.
 */
export const API_BASE: string = import.meta.env?.VITE_API_BASE || '/api/v1';

let unauthorizedHandler: (() => void) | null = null;
/** The auth provider registers here, so any 401 on a signed-in request ends the session in one place. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const client = createApiClient({
  baseUrl: API_BASE,
  fetchFn: (input, init) => fetch(input, init),
  onUnauthorized: () => unauthorizedHandler?.(),
});

export const api = createResidentApi(client);
export const clearCsrf = client.clearCsrf;
