import { Module } from '@nestjs/common';
import { ResidentController } from './resident.controller.js';
import { ResidentService } from './resident.service.js';

@Module({
  controllers: [ResidentController],
  providers: [ResidentService],
  exports: [ResidentService],
})
export class ResidentModule {}