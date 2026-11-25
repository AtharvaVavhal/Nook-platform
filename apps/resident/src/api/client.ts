import { ApiError, errorFromResponse } from './errors.js';
import { CSRF_HEADER, createResidentCsrf } from './csrf.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  fetchFn: FetchLike;
  /** Called when a request that needs a session is refused with 401 (the session ended). */
  onUnauthorized?: () => void;
}

interface RequestOptions {
  signal?: AbortSignal;
  /** The request needs a session; a 401 then means the session ended. False for sign-in calls. */
  authenticated?: boolean;
  csrf?: boolean;
}

/**
 * Thin, explicit HTTP client for the resident API: cookies are sent (`credentials: include`), nothing is stored in the browser,
 * and every failure becomes an ApiError with a kind the screens can word helpfully. No resident or organization id is ever
 * sent: the server derives both from the session.
 */
export function createApiClient({ baseUrl, fetchFn, onUnauthorized }: ApiClientOptions) {
  const csrf = createResidentCsrf(baseUrl, fetchFn);

  async function send(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions,
  ): Promise<Response> {
    const url = `${baseUrl}${path}`;
    for (let attempt = 0; ; attempt += 1) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.csrf) {
        try {
          headers[CSRF_HEADER] = await csrf.token();
        } catch {
          throw new ApiError('network', 0);
        }
      }
      let response: Response;
      try {
        response = await fetchFn(url, {
          method,
          headers,
          credentials: 'include',
          cache: 'no-store',
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new ApiError('network', 0);
      }
      if (
        response.status === 403 &&
        options.csrf &&
        attempt === 0 &&
        (await isCsrfRefusal(response))
      ) {
        csrf.clear();
        continue; // the server refused before running anything, so one retry with a fresh token cannot repeat an action
      }
      return response;
    }
  }

  async function request<T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await send(method, path, body, options);
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = errorFromResponse(response.status, payload);
      if (error.kind === 'unauthorized' && options.authenticated !== false) {
        csrf.clear();
        onUnauthorized?.();
      }
      throw error;
    }
    const data =
      payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : undefined;
    if (data === undefined) throw new ApiError('unexpected', response.status);
    return data as T;
  }

  return {
    get: <T>(path: string, signal?: AbortSignal) =>
      request<T>('GET', path, undefined, { ...(signal ? { signal } : {}) }),
    post: <T>(path: string, body: unknown, options: RequestOptions = {}) =>
      request<T>('POST', path, body, options),
    clearCsrf: () => csrf.clear(),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

async function isCsrfRefusal(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return body.code === 'INVALID_CSRF_TOKEN';
  } catch {
    return false;
  }
}
