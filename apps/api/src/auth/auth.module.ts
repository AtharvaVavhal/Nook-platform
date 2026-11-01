import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuthController } from './auth.controller.js';
import { AUTH_REPOSITORY, PrismaAuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { CsrfService } from './csrf.service.js';
import { CsrfGuard, OriginGuard, SessionGuard } from './auth.guards.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    PrismaService,
    PrismaAuthRepository,
    { provide: AUTH_REPOSITORY, useExisting: PrismaAuthRepository },
    PasswordHasher,
    SessionService,
    AuthService,
    CsrfService,
    SessionGuard,
    OriginGuard,
    CsrfGuard,
  ],
  exports: [AuthService, SessionService, SessionGuard, OriginGuard, CsrfGuard, CsrfService],
})
export class AuthModule {}
