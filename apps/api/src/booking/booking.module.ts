import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';

@Module({
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}