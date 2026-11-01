export interface HttpRequest {
  readonly body?: unknown;
  readonly headers: {
    readonly cookie?: string;
    readonly origin?: string;
    readonly [key: string]: string | string[] | undefined;
  };
}

export interface HttpResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
}

export interface AuthenticatedContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly displayName: string;
  readonly role: 'OWNER' | 'PROPERTY_MANAGER';
}

export type AuthenticatedRequest = HttpRequest & {
  auth?: AuthenticatedContext;
};

export interface AuthUserRecord {
  readonly id: string;
  readonly loginIdentifier: string;
  readonly passwordHash: string;
  readonly displayName: string;
  readonly status: 'ACTIVE' | 'DISABLED';
}

export interface AuthMembershipRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly role: 'OWNER' | 'PROPERTY_MANAGER';
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly status: 'ACTIVE' | 'DISABLED';
  };
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly activeOrganizationId: string | null;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: string | null;
}

export interface AuthRepository {
  findUserByLogin(
    loginIdentifier: string,
  ): Promise<(AuthUserRecord & { readonly memberships: AuthMembershipRecord[] }) | null>;
  updateLastLogin(userId: string, lastLoginAt: Date): Promise<void>;
  createSession(input: {
    tokenHash: string;
    userId: string;
    activeOrganizationId: string;
    createdAt: Date;
    lastSeenAt: Date;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  }): Promise<{ readonly id: string }>;
  findSession(tokenHash: string): Promise<
    | (SessionRecord & {
        readonly user: AuthUserRecord;
        readonly membership: AuthMembershipRecord | null;
      })
    | null
  >;
  touchSession(sessionId: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;
  revokeSession(sessionId: string, reason: string): Promise<void>;
}
