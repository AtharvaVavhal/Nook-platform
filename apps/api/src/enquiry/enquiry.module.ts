import { Module } from '@nestjs/common';
import { EnquiryController } from './enquiry.controller.js';
import { EnquiryService } from './enquiry.service.js';

@Module({
  controllers: [EnquiryController],
  providers: [EnquiryService],
  exports: [EnquiryService],
})
export class EnquiryModule {}