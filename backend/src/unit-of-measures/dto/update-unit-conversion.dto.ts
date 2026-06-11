import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateUnitConversionDto {
  @IsOptional()
  @IsString()
  @MaxLength(24)
  prodUomCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  srUomCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  multiplier?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  ext?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  weight?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
