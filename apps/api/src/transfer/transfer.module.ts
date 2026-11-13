import { TransferFinanceService, TransferFinanceGate } from './transfer-finance.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { Module } from '@nestjs/common';
import { TransferService } from './transfer.service.js';
import { TransferExecutionService, TransferExecutionGate } from './transfer.execution.js';
import { TransferController } from './transfer.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [TransferController],
  providers: [
    TransferService,
    TransferExecutionService,
    TransferExecutionGate,
    TransferFinanceService,
    TransferFinanceGate,
  ],
  exports: [TransferService],
})
export class TransferModule {}
