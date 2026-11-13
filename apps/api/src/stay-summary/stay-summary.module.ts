import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { StaySummaryService } from './stay-summary.service.js';
import { StaySummaryController } from './stay-summary.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule, FinanceModule],
  controllers: [StaySummaryController],
  providers: [StaySummaryService],
  exports: [StaySummaryService],
})
export class StaySummaryModule {}
