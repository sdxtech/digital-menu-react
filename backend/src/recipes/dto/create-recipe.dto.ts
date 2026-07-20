import {
  IsArray,
  IsBoolean,
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

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  prodQty?: number;

  @IsOptional()
  @IsString()
  prodUomCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  srQty?: number;

  @IsOptional()
  @IsBoolean()
  srQtyManual?: boolean;

  @IsOptional()
  @IsString()
  srUomCode?: string;

  @IsOptional()
  @IsString()
  conversionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  conversionMultiplier?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceUom?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  foodCost?: number;
}

export class CreateRecipeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  baseRecipeId?: string;

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
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  foodCostRecipe?: number;

  @IsOptional()
  @IsIn(['draft', 'active'])
  status?: 'draft' | 'active';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients?: RecipeIngredientDto[];
}
