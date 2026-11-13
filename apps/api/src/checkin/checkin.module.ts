import { OriginalAssignmentWriter, AssignmentAdoptionGate } from '../common/assignment-adoption.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { CheckInController } from './checkin.controller.js';
import { CheckInService } from './checkin.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CheckInController],
  providers: [CheckInService, OriginalAssignmentWriter, AssignmentAdoptionGate],
  exports: [CheckInService],
})
export class CheckInModule {}
