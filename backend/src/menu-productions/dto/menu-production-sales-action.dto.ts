import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MenuProductionGroupPriceDto } from './update-menu-production-batch-sales-details.dto';

export class MenuProductionSalesBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  menuProductionIds: string[];
}

export class EditMenuProductionSalesDto extends MenuProductionSalesBatchDto {
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

export class RejectMenuProductionSalesDto extends MenuProductionSalesBatchDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}
