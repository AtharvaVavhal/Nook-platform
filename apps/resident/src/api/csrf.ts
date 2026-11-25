import type { FetchLike } from './client.js';

/**
 * The resident portal's own CSRF handling. It is separate from the owner app on purpose: a different endpoint
 * (`/resident-auth/csrf`) and different cookies. The token lives in memory only (never localStorage or a readable cookie) and
 * is sent as `X-CSRF-Token` on state-changing requests. The only such request in this app is signing out.
 */
export const CSRF_HEADER = 'X-CSRF-Token';

export interface ResidentCsrf {
  token(): Promise<string>;
  clear(): void;
}

export function createResidentCsrf(baseUrl: string, fetchFn: FetchLike): ResidentCsrf {
  let current: string | null = null;
  let pending: Promise<string> | null = null;
  let generation = 0;

  async function load(): Promise<string> {
    const started = generation;
    const response = await fetchFn(`${baseUrl}/resident-auth/csrf`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`csrf ${response.status}`);
    const body = (await response.json()) as { data?: { csrfToken?: unknown } };
    const value = body.data?.csrfToken;
    if (typeof value !== 'string' || value === '') throw new Error('no csrf token');
    if (started === generation) current = value;
    return value;
  }

  return {
    token() {
      if (current) return Promise.resolve(current);
      pending ??= load().finally(() => {
        pending = null;
      });
      return pending;
    },
    clear() {
      generation += 1;
      current = null;
      pending = null;
    },
  };
}
