import { IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMenuProductionSalesDetailsDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellingPricePerPax: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellingQuantity: number;
}
