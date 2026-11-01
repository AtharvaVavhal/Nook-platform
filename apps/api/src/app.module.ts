import { Module } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';
import { PrismaService } from './database/prisma.service.js';
import { HealthController } from './health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ResidentModule } from './resident/resident.module.js';
import { EnquiryModule } from './enquiry/enquiry.module.js';
import { BookingModule } from './booking/booking.module.js';

@Module({
  imports: [AuthModule, InventoryModule, ResidentModule, EnquiryModule, BookingModule],
  controllers: [HealthController],
  providers: [DatabaseService, PrismaService],
})
export class AppModule {}
