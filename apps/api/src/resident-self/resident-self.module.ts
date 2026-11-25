import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { ResidentPortalEnabledGuard } from '../resident-auth/resident-auth.guards.js';
import { StaySummaryModule } from '../stay-summary/stay-summary.module.js';
import { ResidentSelfController } from './resident-self.controller.js';
import { ResidentSelfService } from './resident-self.service.js';

@Module({
  imports: [DatabaseModule, StaySummaryModule, FinanceModule],
  controllers: [ResidentSelfController],
  providers: [ResidentSelfService, ResidentPortalEnabledGuard],
})
export class ResidentSelfModule {}
