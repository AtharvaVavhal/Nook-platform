import { IsString, IsOptional, IsDateString, IsEnum, IsUUID, IsNumber, IsNumberString } from 'class-validator';
import { Type } from 'class-transformer';
import { AdmissionStatus } from '../generated/enums.js';

export enum AdmissionStatusEnum { PENDING = 'PENDING', ADMITTED = 'ADMITTED', CANCELLED = 'CANCELLED' }

export class CreateAdmissionDto {
  @IsUUID()
  bookingId!: string;

  @IsDateString()
  admissionDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateAdmissionDto {
  @IsOptional()
  @IsDateString()
  admissionDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(['PENDING', 'ADMITTED', 'CANCELLED'])
  status?: string;
}

export class AdmissionQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(['PENDING', 'ADMITTED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsUUID()
  residentId?: string;

  @IsOptional()
  @IsUUID()
  bookingId?: string;

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