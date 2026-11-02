import { IsUUID, IsDateString, IsOptional, IsString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum CheckInStatusEnum {
  ACTIVE = 'ACTIVE',
  CHECKED_OUT = 'CHECKED_OUT',
}

export class CreateCheckInDto {
  @IsUUID()
  admissionId!: string;

  /** Optional: defaults to the current time. A value without a zone is read as Asia/Kolkata. */
  @IsOptional()
  @IsDateString()
  checkInAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Only notes are editable; status moves through check-out and the check-in time is not editable. */
export class UpdateCheckInDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateCheckOutDto {
  /** Optional: defaults to the current time. A value without a zone is read as Asia/Kolkata. */
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
