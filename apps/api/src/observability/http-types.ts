/**
 * The few members of Express's request and response that the observability code touches. Express itself ships no
 * type declarations here and adding @types/express would be a new dependency, so these describe just what is used.
 */
export interface HttpRequestLike {
  method: string;
  url?: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  route?: { path?: string };
  auth?: { userId?: string; organizationId?: string; role?: string };
  requestId?: string;
}

export interface HttpResponseLike {
  statusCode: number;
  headersSent: boolean;
  writableEnded: boolean;
  setHeader(name: string, value: string): unknown;
  getHeader(name: string): unknown;
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
  end(): unknown;
  on(event: 'finish' | 'close', listener: () => void): unknown;
}

export type NextFn = (error?: unknown) => void;
