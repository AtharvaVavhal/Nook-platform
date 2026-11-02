import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ResidentController } from './resident.controller.js';
import { ResidentService } from './resident.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ResidentController],
  providers: [ResidentService],
  exports: [ResidentService],
})
export class ResidentModule {}
