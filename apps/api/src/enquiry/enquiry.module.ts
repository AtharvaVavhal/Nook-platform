import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { EnquiryController } from './enquiry.controller.js';
import { EnquiryService } from './enquiry.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [EnquiryController],
  providers: [EnquiryService],
  exports: [EnquiryService],
})
export class EnquiryModule {}
