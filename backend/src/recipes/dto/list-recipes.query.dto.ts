import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListRecipesQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-fA-F0-9]{24}(,[a-fA-F0-9]{24})*$/)
  ids?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  site?: string;

  @IsOptional()
  @IsString()
  sites?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  strictSite?: 'true' | 'false';

  @IsOptional()
  @IsIn(['draft', 'active'])
  status?: 'draft' | 'active';

  @IsOptional()
  @IsString()
  statuses?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  categories?: string;

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  approvalStatus?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}
