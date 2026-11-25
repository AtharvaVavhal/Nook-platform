import { Module } from '@nestjs/common';
import { loadRuntimeConfig } from '../config.js';
import { DatabaseModule } from '../database/database.module.js';
import { ResidentAuditService } from './resident-audit.service.js';
import { ResidentAuthService } from './resident-auth.service.js';
import { ResidentSessionService } from './resident-session.service.js';
import { ResidentThrottleService } from './resident-throttle.service.js';
import { SMS_PROVIDER, SmsDispatcher, type SmsProvider } from './sms/sms.js';
import { createSmsProvider } from './sms/sms.factory.js';

/**
 * Everything the resident principal needs that other modules also consume (the global AccessGuard validates resident
 * sessions). It imports nothing from the owner auth module, so there is no cycle.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    ResidentThrottleService,
    ResidentAuditService,
    ResidentSessionService,
    // The provider is chosen once, here. `mock` is refused in production by the config parser and again by the factory.
    { provide: SMS_PROVIDER, useFactory: () => createSmsProvider(loadRuntimeConfig()) },
    {
      provide: SmsDispatcher,
      useFactory: (provider: SmsProvider) => new SmsDispatcher(provider),
      inject: [SMS_PROVIDER],
    },
    ResidentAuthService,
  ],
  exports: [
    ResidentThrottleService,
    ResidentAuditService,
    ResidentSessionService,
    SMS_PROVIDER,
    SmsDispatcher,
    ResidentAuthService,
  ],
})
export class ResidentAuthCoreModule {}
