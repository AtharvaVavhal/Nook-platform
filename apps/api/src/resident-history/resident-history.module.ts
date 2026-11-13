import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ResidentHistoryService } from './resident-history.service.js';
import { ResidentHistoryController } from './resident-history.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ResidentHistoryController],
  providers: [ResidentHistoryService],
  exports: [ResidentHistoryService],
})
export class ResidentHistoryModule {}
