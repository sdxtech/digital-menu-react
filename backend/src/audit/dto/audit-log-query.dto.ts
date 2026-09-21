import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class AuditLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  site?: string;

  @IsOptional()
  @IsIn(['success', 'failed'])
  status?: 'success' | 'failed';

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX)
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX)
  endDate?: string;
}
