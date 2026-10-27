import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNumber,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

class MenuProductionSalesBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  menuProductionIds: string[];
}

export class EditMenuProductionSalesDto extends MenuProductionSalesBatchDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellingPricePerPax: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellingQuantity: number;
}

export class RejectMenuProductionSalesDto extends MenuProductionSalesBatchDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}
