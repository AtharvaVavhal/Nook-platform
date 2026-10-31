/**
 * Canonical typed API envelopes and error payloads for Nook.
 */

export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    total?: number;
    timestamp?: string;
    organizationId?: string;
  };
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    rule?: string; // Present on 422 RULE_NOT_CONFIGURED
    details?: Record<string, string[]>; // Field-specific validation errors
  };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}
