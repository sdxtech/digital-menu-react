import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class RawMaterialSpecificConversionDto {
  @IsString()
  @IsNotEmpty()
  prodUomCode: string;

  @IsString()
  @IsNotEmpty()
  srUomCode: string;

  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0.000001)
  conversionFactor: number;
}

export class CreateRawMaterialDto {
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
  baseUnitOfMeasures?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  conversionFactor?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RawMaterialSpecificConversionDto)
  specificConversions?: RawMaterialSpecificConversionDto[];

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  minimumQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  price?: number;
}
