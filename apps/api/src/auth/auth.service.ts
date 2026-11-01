import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AUTH_REPOSITORY } from './auth.repository.js';
import { normalizeLoginIdentifier } from './auth.dto.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionService } from './session.service.js';
import type { AuthRepository, AuthenticatedContext } from './auth.types.js';

const DUMMY_PASSWORD_HASH =
  'scrypt$BwcHBwcHBwcHBwcHBwcHBw$4jEHwRyxQAtuUIG87rGkFLwxMj3X2njs208tYSC9ojdg5iSVHSJdY1HaZku_qv4QPTJmPYVHDQrhMJHunQXSYA';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(PasswordHasher) private readonly passwords: PasswordHasher,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{
    readonly secret: string;
    readonly context: AuthenticatedContext;
  }> {
    const user = await this.repository.findUserByLogin(normalizeLoginIdentifier(email));
    const membership = user?.memberships.find(
      (candidate) => candidate.status === 'ACTIVE' && candidate.organization.status === 'ACTIVE',
    );
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordValid = await this.passwords.verify(password, passwordHash);
    const valid = user && user.status === 'ACTIVE' && membership && passwordValid;
    if (!valid || !membership || !user) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    const session = await this.sessions.create(user.id, membership.organizationId);
    await this.repository.updateLastLogin(user.id, new Date());
    return {
      secret: session.secret,
      context: {
        sessionId: session.sessionId,
        userId: user.id,
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        displayName: user.displayName,
        role: membership.role,
      },
    };
  }
}
