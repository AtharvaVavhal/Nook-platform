import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { CorrectionsController } from './corrections.controller.js';
import { CorrectionsService } from './corrections.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, FinanceModule],
  controllers: [CorrectionsController],
  providers: [CorrectionsService],
  exports: [CorrectionsService],
})
export class CorrectionsModule {}
