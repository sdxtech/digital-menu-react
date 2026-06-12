import {
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateUnitConversionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  prodUomCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  srUomCode: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  multiplier: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  ext: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  weight: number;
}
