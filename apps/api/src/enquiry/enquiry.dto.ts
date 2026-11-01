import { IsString, IsOptional, IsDateString, IsEmail, IsEnum, IsNumber, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { EnquiryStatus, EnquirySource } from '../generated/enums.js';

export class CreateEnquiryDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  preferredPropertyId?: string;

  @IsOptional()
  @IsString()
  preferredRoomType?: string;

  @IsOptional()
  @IsDateString()
  expectedMoveInDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expectedDurationOfStay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  numberOfOccupants?: number;

  @IsOptional()
  @IsEnum(EnquirySource)
  source?: EnquirySource = 'OTHER';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;
}

export class UpdateEnquiryDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  preferredPropertyId?: string;

  @IsOptional()
  @IsString()
  preferredRoomType?: string;

  @IsOptional()
  @IsDateString()
  expectedMoveInDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expectedDurationOfStay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  numberOfOccupants?: number;

  @IsOptional()
  @IsEnum(EnquirySource)
  source?: EnquirySource;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum({ NEW: 'NEW', CONTACTED: 'CONTACTED', FOLLOW_UP: 'FOLLOW_UP', INTERESTED: 'INTERESTED', CONVERTED: 'CONVERTED', LOST: 'LOST' })
  status?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;
}

export class EnquiryQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum({ NEW: 'NEW', CONTACTED: 'CONTACTED', FOLLOW_UP: 'FOLLOW_UP', INTERESTED: 'INTERESTED', CONVERTED: 'CONVERTED', LOST: 'LOST' })
  status?: string;

  @IsOptional()
  @IsEnum({ WEBSITE: 'WEBSITE', PHONE_CALL: 'PHONE_CALL', WALK_IN: 'WALK_IN', REFERRAL: 'REFERRAL', SOCIAL_MEDIA: 'SOCIAL_MEDIA', OTHER: 'OTHER' })
  source?: string;

  @IsOptional()
  @IsString()
  propertyId?: string;

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

export class CreateFollowUpDto {
  @IsString()
  notes!: string;

  @IsDateString()
  followUpAt!: string;

  @IsOptional()
  @IsString()
  outcome?: string;
}