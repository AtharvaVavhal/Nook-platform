import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

export function runWithRequest<T>(store: RequestStore, fn: () => T): T {
  return storage.run(store, fn);
}

/** The id of the HTTP request being handled, if there is one (jobs and startup code have none). */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** The request id to store on an audit event: the current HTTP request's, or a fresh one outside any request. */
export function auditRequestId(): string {
  return currentRequestId() ?? randomUUID();
}
