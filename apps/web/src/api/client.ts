import {
  type ApiResponse,
  type ApiErrorPayload,
  type RequestOptions,
} from './types';
import {
  createErrorFromResponse,
  NetworkError,
  TimeoutError,
} from './errors';

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<ApiResponse<T>>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<ApiResponse<T>>;
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<ApiResponse<T>>;
  delete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<ApiResponse<T>>;
}

export function createApiClient(baseUrl = '/api/v1'): ApiClient {
  async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      body,
      headers: customHeaders = {},
      idempotencyKey,
      signal: callerSignal,
      timeoutMs = 15000,
    } = options;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Handle timeout
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        controller.abort(new TimeoutError(timeoutMs));
      }, timeoutMs);
    }

    // Merge caller signal with timeout controller
    if (callerSignal) {
      if (callerSignal.aborted) {
        if (timeoutId) clearTimeout(timeoutId);
        throw callerSignal.reason ?? new DOMException('Request aborted', 'AbortError');
      }
      callerSignal.addEventListener('abort', () => {
        if (timeoutId) clearTimeout(timeoutId);
        controller.abort(callerSignal.reason);
      });
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...customHeaders,
    };

    if (body !== undefined && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

    const requestInit: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    let response: Response;
    try {
      response = await fetch(url, requestInit);
    } catch (err: unknown) {
      if (err instanceof TimeoutError) {
        throw err;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    let payload: unknown = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      throw createErrorFromResponse(response.status, payload as ApiErrorPayload | null);
    }

    // Wrap plain responses into standard ApiResponse envelope if not already enveloped
    if (payload && typeof payload === 'object' && 'data' in payload) {
      return payload as ApiResponse<T>;
    }

    return { data: payload as T };
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  };
}
