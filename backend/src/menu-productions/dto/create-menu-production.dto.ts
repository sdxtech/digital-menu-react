import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMenuProductionDto {
  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  recipeId: string;

  @IsString()
  @IsOptional()
  menuName?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  site?: string;

  @IsString()
  @IsMongoId()
  @IsOptional()
  chefId?: string;

  @IsString()
  @IsMongoId()
  @IsOptional()
  unitManagerId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  portion: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  productionDate: string;
}
