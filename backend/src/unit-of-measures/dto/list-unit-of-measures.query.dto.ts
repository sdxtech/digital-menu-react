import { IsBooleanString, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class ListUnitOfMeasuresQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
