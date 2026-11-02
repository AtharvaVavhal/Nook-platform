import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AUTH_REPOSITORY } from './auth.repository.js';
import { normalizeLoginIdentifier } from './auth.dto.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionService } from './session.service.js';
import { AuthAuditService } from './auth-audit.service.js';
import { LoginThrottleService } from './throttle.service.js';
import {
  checkNewPassword,
  describePasswordProblem,
  identifierTag,
  THROTTLE_LIMITS,
} from './auth-security.js';
import type { AuthRepository, AuthenticatedContext } from './auth.types.js';

const DUMMY_PASSWORD_HASH =
  'scrypt$BwcHBwcHBwcHBwcHBwcHBw$4jEHwRyxQAtuUIG87rGkFLwxMj3X2njs208tYSC9ojdg5iSVHSJdY1HaZku_qv4QPTJmPYVHDQrhMJHunQXSYA';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(PasswordHasher) private readonly passwords: PasswordHasher,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(LoginThrottleService) private readonly throttle: LoginThrottleService,
    @Inject(AuthAuditService) private readonly audit: AuthAuditService,
  ) {}

  private tooManyAttempts(until: Date): HttpException {
    const retryAfterSeconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
    return new HttpException(
      { code: 'RATE_LIMITED', retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  async login(
    email: string,
    password: string,
    address = 'unknown',
  ): Promise<{
    readonly secret: string;
    readonly context: AuthenticatedContext;
  }> {
    const identifier = normalizeLoginIdentifier(email);
    const keys = [
      { scope: 'IDENTIFIER', value: identifier },
      { scope: 'ADDRESS', value: address },
    ] as const;

    // Locked keys are refused before any password is checked, so the answer never depends on whether
    // the account exists or the password is right.
    const lockedUntil = await this.throttle.lockedUntil(keys);
    if (lockedUntil) {
      await this.audit.record('auth.login.throttled', {
        metadata: { identifier: identifierTag(identifier) },
      });
      throw this.tooManyAttempts(lockedUntil);
    }

    const user = await this.repository.findUserByLogin(identifier);
    const membership = user?.memberships.find(
      (candidate) => candidate.status === 'ACTIVE' && candidate.organization.status === 'ACTIVE',
    );
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordValid = await this.passwords.verify(password, passwordHash);
    const valid = user && user.status === 'ACTIVE' && membership && passwordValid;
    if (!valid || !membership || !user) {
      await Promise.all(keys.map((key) => this.throttle.recordFailure(key)));
      await this.audit.record('auth.login.failed', {
        organizationId: membership?.organizationId ?? null,
        actorUserId: user?.id ?? null,
        metadata: user ? {} : { identifier: identifierTag(identifier) },
      });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    await this.throttle.reset(keys[0]);
    const session = await this.sessions.create(user.id, membership.organizationId);
    await this.repository.updateLastLogin(user.id, new Date());
    await this.audit.record('auth.login.succeeded', {
      organizationId: membership.organizationId,
      actorUserId: user.id,
      metadata: { sessionId: session.sessionId },
    });
    return {
      secret: session.secret,
      context: {
        sessionId: session.sessionId,
        userId: user.id,
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        displayName: user.displayName,
        role: membership.role,
        passwordChangeRequired: user.passwordChangeRequired,
      },
    };
  }

  async logout(context: AuthenticatedContext): Promise<void> {
    await this.sessions.revoke(context.sessionId);
    await this.audit.record('auth.logout', {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      metadata: { sessionId: context.sessionId },
    });
  }

  /** Change the signed-in user's own password. Revokes every other session of that user. */
  async changePassword(
    context: AuthenticatedContext,
    currentPassword: unknown,
    newPassword: unknown,
  ): Promise<{ revokedSessions: number }> {
    if (typeof currentPassword !== 'string' || currentPassword === '') {
      throw new BadRequestException({ code: 'CURRENT_PASSWORD_REQUIRED' });
    }
    const key = { scope: 'PASSWORD', value: context.userId } as const;
    const lockedUntil = await this.throttle.lockedUntil([key]);
    if (lockedUntil) throw this.tooManyAttempts(lockedUntil);

    const user = await this.repository.findUserById(context.userId);
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    if (!(await this.passwords.verify(currentPassword, user.passwordHash))) {
      await this.throttle.recordFailure(key);
      await this.audit.record('auth.password.change_failed', {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        metadata: { reason: 'current_password_invalid', limit: THROTTLE_LIMITS.PASSWORD },
      });
      throw new BadRequestException({ code: 'CURRENT_PASSWORD_INVALID' });
    }
    const problem = checkNewPassword(newPassword, currentPassword, user.loginIdentifier);
    if (problem) {
      throw new BadRequestException({
        code: 'NEW_PASSWORD_REJECTED',
        reason: problem,
        message: describePasswordProblem(problem),
      });
    }
    const result = await this.repository.changePassword({
      userId: user.id,
      organizationId: context.organizationId,
      passwordHash: await this.passwords.hash(newPassword as string),
      keepSessionId: context.sessionId,
    });
    await this.throttle.reset(key);
    return result;
  }
}
