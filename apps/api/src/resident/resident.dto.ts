import { IsString, IsOptional, IsDateString, IsEmail, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ResidentStatus, DocumentVerificationStatus } from '../generated/enums.js';

export class CreateResidentDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  emergencyContactRelation?: string;

  @IsOptional()
  documentMetadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  documentUrl?: string;

  @IsOptional()
  @IsEnum(DocumentVerificationStatus)
  documentVerificationStatus?: DocumentVerificationStatus;

  @IsOptional()
  @IsEnum(ResidentStatus)
  status?: ResidentStatus;
}

export class UpdateResidentDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  emergencyContactRelation?: string;

  @IsOptional()
  documentMetadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  documentUrl?: string;

  @IsOptional()
  @IsEnum(DocumentVerificationStatus)
  documentVerificationStatus?: DocumentVerificationStatus;

  @IsOptional()
  @IsEnum(ResidentStatus)
  status?: ResidentStatus;
}

export class ResidentQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ResidentStatus)
  status?: ResidentStatus;

  @IsOptional()
  @IsEnum(DocumentVerificationStatus)
  documentVerificationStatus?: DocumentVerificationStatus;

  @IsOptional()
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsOptional()
  limit?: number = 20;
}