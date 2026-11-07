import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AUTH_REPOSITORY, PrismaAuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { CsrfService } from './csrf.service.js';
import { CsrfGuard, OriginGuard, SessionGuard } from './auth.guards.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionService } from './session.service.js';
import { AuthAuditService } from './auth-audit.service.js';
import { LoginThrottleService } from './throttle.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    PrismaAuthRepository,
    { provide: AUTH_REPOSITORY, useExisting: PrismaAuthRepository },
    PasswordHasher,
    SessionService,
    LoginThrottleService,
    AuthAuditService,
    AuthService,
    CsrfService,
    SessionGuard,
    OriginGuard,
    CsrfGuard,
  ],
  exports: [AuthService, SessionService, SessionGuard, OriginGuard, CsrfGuard, CsrfService],
})
export class AuthModule {}
