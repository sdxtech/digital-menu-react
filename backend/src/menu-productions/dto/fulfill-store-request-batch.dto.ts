import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class FulfillStoreRequestBatchItemDto {
  @IsString()
  @IsNotEmpty()
  productCode: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  unitOfMeasures: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  vendorSite?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  actualQty: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  actualPrice?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class FulfillStoreRequestBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  menuProductionIds: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FulfillStoreRequestBatchItemDto)
  items: FulfillStoreRequestBatchItemDto[];

  @IsOptional()
  @IsString()
  note?: string;
}
