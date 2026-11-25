import type { HttpRequest } from '../auth/auth.types.js';

/** The authenticated resident, derived only from the server-side session. Never from a request body, header or URL. */
export interface ResidentAuthContext {
  readonly sessionId: string;
  readonly accountId: string;
  readonly residentId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly displayName: string;
}

export type ResidentAuthenticatedRequest = HttpRequest & {
  residentAuth?: ResidentAuthContext;
};
