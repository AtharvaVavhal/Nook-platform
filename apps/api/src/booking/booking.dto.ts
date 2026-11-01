import { IsUUID, IsDateString, IsNumber, Min, IsOptional, IsString, IsEnum, IsNumberString } from 'class-validator';
import { Type } from 'class-transformer';
import { BookingStatus, PaymentStatus } from '../generated/enums.js';

export enum BookingStatusEnum { CONFIRMED = 'CONFIRMED', CANCELLED = 'CANCELLED' }
export enum PaymentStatusEnum { PENDING = 'PENDING', PAID = 'PAID', OVERDUE = 'OVERDUE', REFUNDED = 'REFUNDED' }

export class CreateBookingDto {
  @IsUUID()
  residentId!: string;

  @IsUUID()
  bedId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string; // exclusive end date

  @IsNumber()
  @Min(0)
  monthlyPrice!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBookingDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyPrice?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus; // only CANCELLED allowed

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;
}

export class BookingQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(['CONFIRMED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsEnum(['PENDING', 'PAID', 'OVERDUE', 'REFUNDED'])
  paymentStatus?: string;

  @IsOptional()
  @IsUUID()
  residentId?: string;

  @IsOptional()
  @IsUUID()
  bedId?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}