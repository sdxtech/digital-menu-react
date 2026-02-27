import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RecipeIngredientDto {
  @IsString()
  @IsNotEmpty()
  productCode: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  unitOfMeasures: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qty: number;
}

export class CreateRecipeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUrl({
    require_protocol: true,
    require_tld: false,
    protocols: ['http', 'https'],
  })
  imageUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  portionSize?: number;

  @IsOptional()
  @IsIn(['draft', 'active'])
  status?: 'draft' | 'active';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients?: RecipeIngredientDto[];
}
