import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ResidentAuthCoreModule } from '../resident-auth/resident-auth-core.module.js';
import { ResidentAccountController } from './resident-account.controller.js';
import { ResidentAccountService } from './resident-account.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, ResidentAuthCoreModule],
  controllers: [ResidentAccountController],
  providers: [ResidentAccountService],
})
export class ResidentAccountModule {}
