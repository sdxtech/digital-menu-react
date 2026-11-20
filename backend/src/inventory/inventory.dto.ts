import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class InventoryLineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  productCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unitOfMeasures: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1e12)
  quantity: number;
}

export class OpeningInventoryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => InventoryLineDto)
  lines: InventoryLineDto[];
}

export class ConfirmOpeningInventoryDto {
  @IsMongoId()
  previewId: string;
}

export class CreateInventoryReceiptDto {
  @IsUUID()
  requestId: string;

  @IsDateString({ strict: true })
  receivedDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => InventoryLineDto)
  lines: InventoryLineDto[];
}

export class ReverseInventoryReceiptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export class ConfirmPurchaseOrderDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  receivedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160000)
  receivedDates?: string;

  @IsString()
  @MaxLength(160000)
  quantities: string;
}

export class InventoryQueryDto {
  @IsOptional()
  @IsIn(['lines'])
  view?: 'lines';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  site?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  asOf?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
