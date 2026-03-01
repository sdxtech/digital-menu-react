import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RecipeIngredientDto } from './create-recipe.dto';

export class UpdateRecipeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  category?: string;

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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients?: RecipeIngredientDto[];
}
