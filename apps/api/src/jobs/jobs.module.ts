import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { InvoiceSchedulerService } from './invoice-scheduler.service.js';

/** The standalone application context the scheduled jobs run in (no HTTP server is started). */
@Module({
  imports: [DatabaseModule, FinanceModule],
  providers: [InvoiceSchedulerService],
  exports: [InvoiceSchedulerService],
})
export class JobsModule {}
