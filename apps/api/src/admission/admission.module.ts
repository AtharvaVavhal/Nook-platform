import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AdmissionController } from './admission.controller.js';
import { AdmissionService } from './admission.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AdmissionController],
  providers: [AdmissionService],
  exports: [AdmissionService],
})
export class AdmissionModule {}
