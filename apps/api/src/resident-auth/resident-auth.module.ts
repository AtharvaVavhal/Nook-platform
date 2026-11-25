import { Module } from '@nestjs/common';
import { CsrfService } from '../auth/csrf.service.js';
import { ResidentAuthController } from './resident-auth.controller.js';
import { ResidentAuthCoreModule } from './resident-auth-core.module.js';
import {
  ResidentCsrfGuard,
  ResidentOriginGuard,
  ResidentPortalEnabledGuard,
} from './resident-auth.guards.js';

@Module({
  imports: [ResidentAuthCoreModule],
  controllers: [ResidentAuthController],
  providers: [CsrfService, ResidentPortalEnabledGuard, ResidentOriginGuard, ResidentCsrfGuard],
})
export class ResidentAuthModule {}
