import { Module } from '@nestjs/common';
import { CheckInController } from './checkin.controller.js';
import { CheckInService } from './checkin.service.js';

@Module({
  controllers: [CheckInController],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {}