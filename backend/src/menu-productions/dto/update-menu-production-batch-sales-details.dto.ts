import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MenuProductionGroupPriceDto {
  @IsString()
  name: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellingPricePerPax: number;
}

export class UpdateMenuProductionBatchSalesDetailsDto {
  @IsString()
  productionCode: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellingPricePerPax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellingQuantity?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MenuProductionGroupPriceDto)
  groupPrices?: MenuProductionGroupPriceDto[];
}
