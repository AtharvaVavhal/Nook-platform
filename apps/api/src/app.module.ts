import { Module } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';
import { HealthController } from './health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ResidentModule } from './resident/resident.module.js';
import { EnquiryModule } from './enquiry/enquiry.module.js';
import { BookingModule } from './booking/booking.module.js';
import { AdmissionModule } from './admission/admission.module.js';
import { CheckInModule } from './checkin/checkin.module.js';
import { FinanceModule } from './finance/finance.module.js';

@Module({
  imports: [AuthModule, InventoryModule, ResidentModule, EnquiryModule, BookingModule, AdmissionModule, CheckInModule, FinanceModule],
  controllers: [HealthController],
  providers: [DatabaseService],
})
export class AppModule {}
