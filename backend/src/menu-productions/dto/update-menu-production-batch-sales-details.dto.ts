import { IsNumber, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMenuProductionBatchSalesDetailsDto {
  @IsString()
  productionCode: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellingPricePerPax: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellingQuantity: number;
}
