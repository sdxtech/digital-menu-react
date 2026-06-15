import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class BulkUpdateSpecificConversionsDto {
  @IsString()
  @IsNotEmpty()
  search: string;

  @IsString()
  @IsNotEmpty()
  unitOfMeasures: string;

  @IsString()
  @IsNotEmpty()
  baseUnitOfMeasures: string;

  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0.000001)
  conversionFactor: number;
}
