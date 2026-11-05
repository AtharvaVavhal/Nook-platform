import assert from 'node:assert/strict';
import test from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { CSRF_COOKIE, CsrfGuard, OriginGuard, SESSION_COOKIE } from '../src/auth/auth.guards.js';
import { CsrfService } from '../src/auth/csrf.service.js';
import { normalizeLoginIdentifier } from '../src/auth/auth.dto.js';
import { PasswordHasher } from '../src/auth/password-hasher.js';
import {
  hashSessionSecret,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SessionService,
} from '../src/auth/session.service.js';
import type {
  AuthMembershipRecord,
  AuthRepository,
  AuthUserRecord,
  SessionRecord,
} from '../src/auth/auth.types.js';

class FakeAuthRepository implements AuthRepository {
  user: (AuthUserRecord & { memberships: AuthMembershipRecord[] }) | null = null;
  session:
    | (SessionRecord & {
        user: AuthUserRecord;
        membership: AuthMembershipRecord | null;
      })
    | null = null;
  touched: { sessionId: string; lastSeenAt: Date; idleExpiresAt: Date } | null = null;
  revoked: { sessionId: string; reason: string } | null = null;
  loginIdentifier: string | null = null;

  async findUserByLogin(loginIdentifier: string) {
    this.loginIdentifier = loginIdentifier;
    return this.user;
  }

  async updateLastLogin(): Promise<void> {}

  async createSession(): Promise<{ id: string }> {
    return { id: 'session-1' };
  }

  async findSession() {
    return this.session;
  }

  async touchSession(sessionId: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    this.touched = { sessionId, lastSeenAt, idleExpiresAt };
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    this.revoked = { sessionId, reason };
  }

  async findUserById(): Promise<AuthUserRecord | null> {
    return this.user;
  }

  async changePassword(): Promise<{ revokedSessions: number }> {
    return { revokedSessions: 0 };
  }
}

// Throttle and audit behaviour is covered by the database-backed integration suite; these unit tests
// exercise credential checking only, so inert fakes stand in for both collaborators.
const noThrottle = {
  async lockedUntil() {
    return null;
  },
  async recordFailure() {},
  async reset() {},
} as never;
const noAudit = { async record() {} } as never;

function membership(
  status: 'ACTIVE' | 'REVOKED' = 'ACTIVE',
  organizationStatus: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
): AuthMembershipRecord {
  return {
    id: 'membership-1',
    organizationId: 'organization-1',
    role: 'OWNER',
    status,
    organization: {
      id: 'organization-1',
      name: 'Nook',
      status: organizationStatus,
    },
  };
}

function user(passwordHash: string, status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
  return {
    id: 'user-1',
    loginIdentifier: 'owner@example.com',
    passwordHash,
    displayName: 'Owner',
    status,
    passwordChangeRequired: false,
    memberships: [membership()],
  };
}

function session(
  userRecord: AuthUserRecord,
  membershipRecord: AuthMembershipRecord | null,
  overrides: Partial<SessionRecord> = {},
) {
  const now = new Date();
  return {
    id: 'session-1',
    userId: userRecord.id,
    activeOrganizationId: membershipRecord?.organizationId ?? null,
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
    user: userRecord,
    membership: membershipRecord,
  };
}

test('password hashing uses scrypt and rejects incorrect passwords', async () => {
  const hasher = new PasswordHasher();
  const encoded = await hasher.hash('correct horse battery staple');
  assert.match(encoded, /^scrypt\$[^$]+\$[^$]+$/);
  assert.equal(await hasher.verify('correct horse battery staple', encoded), true);
  assert.equal(await hasher.verify('wrong password', encoded), false);
  assert.equal(await hasher.verify('anything', 'not-a-scrypt-hash'), false);
});

test('login normalizes email and rejects disabled users or revoked memberships', async () => {
  const repository = new FakeAuthRepository();
  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hash('password');
  repository.user = user(passwordHash);
  const service = new AuthService(
    repository,
    hasher,
    new SessionService(repository),
    noThrottle,
    noAudit,
  );

  const result = await service.login('  OWNER@EXAMPLE.COM ', 'password');
  assert.equal(result.context.organizationId, 'organization-1');
  assert.equal(repository.loginIdentifier, normalizeLoginIdentifier(' OWNER@EXAMPLE.COM '));

  repository.user = user(passwordHash, 'DISABLED');
  await assert.rejects(() => service.login('owner@example.com', 'password'), UnauthorizedException);

  repository.user = { ...user(passwordHash), memberships: [membership('REVOKED')] };
  await assert.rejects(() => service.login('owner@example.com', 'password'), UnauthorizedException);
});

test('sessions store a hash, enforce both expiries, touch active sessions, and revoke', async () => {
  const repository = new FakeAuthRepository();
  const service = new SessionService(repository);
  const created = await service.create('user-1', 'organization-1');
  assert.equal(created.secret.length > 20, true);
  assert.notEqual(hashSessionSecret(created.secret), created.secret);

  const activeUser = user('hash');
  repository.session = session(activeUser, membership());
  const context = await service.authenticate('session-secret');
  assert.equal(context?.organizationId, 'organization-1');
  assert.equal(repository.touched?.sessionId, 'session-1');

  repository.session = session(activeUser, membership(), {
    idleExpiresAt: new Date(Date.now() - 1),
  });
  assert.equal(await service.authenticate('session-secret'), null);

  repository.session = session(activeUser, membership(), {
    absoluteExpiresAt: new Date(Date.now() - 1),
  });
  assert.equal(await service.authenticate('session-secret'), null);

  repository.session = session(activeUser, membership(), {
    activeOrganizationId: 'other-organization',
  });
  assert.equal(await service.authenticate('session-secret'), null);

  repository.session = session(activeUser, membership('ACTIVE', 'DISABLED'));
  assert.equal(await service.authenticate('session-secret'), null);

  await service.revoke('session-1');
  assert.deepEqual(repository.revoked, { sessionId: 'session-1', reason: 'logout' });
});

test('CSRF tokens are unpredictable and require an exact constant-time match', () => {
  const csrf = new CsrfService();
  const token = csrf.createToken();
  assert.equal(token.length > 20, true);
  assert.equal(csrf.matches(token, token), true);
  assert.equal(csrf.matches(token, `${token}x`), false);
  assert.equal(csrf.matches(token, undefined), false);
});

test('origin validation accepts only the configured application origin', () => {
  const saved = process.env.APP_ENV;
  process.env.APP_ENV = 'test';
  const guard = new OriginGuard();
  const context = (origin: string | undefined) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { origin } }),
      }),
    }) as never;
  try {
    assert.equal(guard.canActivate(context('http://localhost:5173')), true);
    assert.throws(() => guard.canActivate(context(undefined)));
    assert.throws(() => guard.canActivate(context('https://localhost:5173')));
  } finally {
    if (saved === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = saved;
  }
});

test('CSRF guard rejects missing, malformed, duplicate, and mismatched tokens', () => {
  const csrf = new CsrfService();
  const guard = new CsrfGuard(csrf);
  const context = (headers: Record<string, string | string[] | undefined>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    }) as never;
  const token = csrf.createToken();
  const cookie = `${CSRF_COOKIE}=${token}`;
  assert.equal(guard.canActivate(context({ cookie, 'x-csrf-token': token })), true);
  assert.throws(() => guard.canActivate(context({ cookie })));
  assert.throws(() => guard.canActivate(context({ cookie, 'x-csrf-token': ['wrong', token] })));
  assert.throws(() =>
    guard.canActivate(context({ cookie: `${CSRF_COOKIE}=%invalid`, 'x-csrf-token': token })),
  );
});

test('production login cookies are host-only, HttpOnly, secure and strict (session and CSRF alike)', async () => {
  const saved = {
    APP_ENV: process.env.APP_ENV,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS,
  };
  process.env.APP_ENV = 'production';
  process.env.WEB_ORIGIN = 'https://app.example.com';
  process.env.TRUST_PROXY_HOPS = '1';
  const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const controller = new AuthController(
    {
      login: async () => ({
        secret: 'session-secret',
        context: {
          sessionId: 'session-1',
          userId: 'user-1',
          organizationId: 'organization-1',
          organizationName: 'Nook',
          displayName: 'Owner',
          role: 'OWNER' as const,
        },
      }),
    } as never,
    new CsrfService(),
    { revoke: async () => {} } as never,
  );
  try {
    await controller.login(
      { body: { email: 'owner@example.com', password: 'password' }, headers: {} },
      {
        cookie: (name, value, options) => cookies.push({ name, value, options }),
        clearCookie: () => {},
        setHeader: () => {},
      },
    );
    assert.equal(cookies[0]?.name, SESSION_COOKIE);
    assert.equal(cookies[0]?.options.httpOnly, true);
    assert.equal(cookies[0]?.options.secure, true);
    assert.equal(cookies[0]?.options.sameSite, 'strict');
    assert.equal(cookies[1]?.name, CSRF_COOKIE);
    // The browser app never reads the CSRF cookie (it gets the token from GET /auth/csrf), so it is HttpOnly too.
    assert.equal(cookies[1]?.options.httpOnly, true);
    assert.equal(cookies[1]?.options.secure, true);
    assert.equal(cookies[1]?.options.sameSite, 'strict');
    for (const cookie of cookies) {
      assert.equal('domain' in cookie.options, false, `${cookie.name} must be host-only`);
    }
  } finally {
    if (saved.TRUST_PROXY_HOPS === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = saved.TRUST_PROXY_HOPS;
    if (saved.APP_ENV === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = saved.APP_ENV;
    if (saved.WEB_ORIGIN === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = saved.WEB_ORIGIN;
  }
});
