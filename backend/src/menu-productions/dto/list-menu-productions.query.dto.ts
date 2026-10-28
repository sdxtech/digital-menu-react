import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  Max,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListMenuProductionsQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  salesInput?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  site?: string;

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  approvalStatus?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsIn(['not-requested', 'requested', 'fulfilled', 'cancelled'])
  storeRequestStatus?:
    | 'not-requested'
    | 'requested'
    | 'fulfilled'
    | 'cancelled';

  @IsOptional()
  @IsString()
  productionDate?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

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
  @IsIn(['sales', 'records', 'records-all', 'approval'])
  view?: 'sales' | 'records' | 'records-all' | 'approval';

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdBefore?: string;

  @IsOptional()
  @IsIn(['production-asc', 'production-desc', 'created-asc', 'created-desc'])
  dateSort?: string;
}
