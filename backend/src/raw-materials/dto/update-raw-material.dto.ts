import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateRawMaterialDto {
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
  site?: string;

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
