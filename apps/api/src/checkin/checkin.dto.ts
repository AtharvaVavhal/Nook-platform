import { IsUUID, IsDateString, IsOptional, IsString, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { CheckInStatus } from '../generated/enums.js';

export enum CheckInStatusEnum { ACTIVE = 'ACTIVE', CHECKED_OUT = 'CHECKED_OUT' }

export class CreateCheckInDto {
  @IsUUID()
  admissionId!: string;

  @IsDateString()
  checkInAt!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCheckInDto {
  @IsOptional()
  @IsDateString()
  checkInAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(CheckInStatus)
  status?: string;
}

export class CreateCheckOutDto {
  @IsUUID()
  checkInId!: string;

  @IsDateString()
  checkOutAt!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCheckOutDto {
  @IsOptional()
  @IsDateString()
  checkOutAt?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CheckInQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(['ACTIVE', 'CHECKED_OUT'])
  status?: string;

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