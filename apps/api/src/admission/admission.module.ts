import { Module } from '@nestjs/common';
import { AdmissionController } from './admission.controller.js';
import { AdmissionService } from './admission.service.js';

@Module({
  controllers: [AdmissionController],
  providers: [AdmissionService],
  exports: [AdmissionService],
})
export class AdmissionModule {}