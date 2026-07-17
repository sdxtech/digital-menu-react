import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
} from 'class-validator';

export class BulkUpdateSpecificConversionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsMongoId({ each: true })
  rawMaterialIds: string[];

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
