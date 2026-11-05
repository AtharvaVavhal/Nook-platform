/**
 * CSRF token handling for the browser client.
 *
 * The API session lives in an HttpOnly, host-only cookie on the API host. State-changing requests must also
 * carry a CSRF token in the `X-CSRF-Token` header, which the server compares with its own (HttpOnly) cookie.
 * The browser app never reads a cookie: it fetches the token from the body of `GET /auth/csrf` and keeps it in
 * module memory only. Nothing is written to localStorage, sessionStorage or document.cookie.
 *
 * The token is cleared whenever the session changes (sign-in, sign-out, a 401), so the next write fetches the
 * value that belongs to the new session. A write refused because of a stale token is retried once with a fresh
 * one; the server refuses before it runs anything, so the retry cannot repeat an action.
 */
export const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CsrfClient {
  /** The current token, fetched on first use. */
  token(): Promise<string>;
  /** Forget the token (the session changed); the next state-changing request fetches a new one. */
  clear(): void;
  /** fetch with credentials included, and the CSRF header on every state-changing method. */
  request(url: string, init?: RequestInit): Promise<Response>;
}

export function createCsrfClient(baseUrl: string, fetchFn: FetchLike): CsrfClient {
  let current: string | null = null;
  let pending: Promise<string> | null = null;
  // Bumped by clear(): a fetch that was already in flight when the session changed must not repopulate the cache.
  let generation = 0;

  async function load(): Promise<string> {
    const started = generation;
    const response = await fetchFn(`${baseUrl}/auth/csrf`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Could not obtain a CSRF token (status ${response.status})`);
    const body = (await response.json()) as { data?: { csrfToken?: unknown } };
    const value = body.data?.csrfToken;
    if (typeof value !== 'string' || value === '') throw new Error('The server sent no CSRF token');
    if (started === generation) current = value;
    return value;
  }

  const client: CsrfClient = {
    async token() {
      if (current) return current;
      if (!pending) {
        pending = load().finally(() => {
          pending = null;
        });
      }
      return pending;
    },
    clear() {
      generation += 1;
      current = null;
      pending = null;
    },
    async request(url, init = {}) {
      const method = (init.method ?? 'GET').toUpperCase();
      if (SAFE_METHODS.has(method)) {
        return fetchFn(url, { ...init, credentials: 'include' });
      }
      for (let attempt = 0; ; attempt += 1) {
        const token = await client.token();
        const headers = new Headers(init.headers);
        headers.set(CSRF_HEADER, token);
        const response = await fetchFn(url, { ...init, headers, credentials: 'include' });
        if (response.status === 403 && attempt === 0 && (await isCsrfRefusal(response))) {
          client.clear();
          continue;
        }
        return response;
      }
    },
  };
  return client;
}

async function isCsrfRefusal(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return body.code === 'INVALID_CSRF_TOKEN';
  } catch {
    return false;
  }
}
