import {
  IsInt,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMenuProductionIngredientVendorDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  ingredientIndex?: number;

  @IsString()
  @IsOptional()
  productCode?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  unitOfMeasures?: string;

  @IsString()
  @IsOptional()
  vendor?: string;

  @IsString()
  @IsOptional()
  site?: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minimumQuantity?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  ingredientCost?: number;
}

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
  @IsOptional()
  clientId?: string;

  @IsString()
  @IsOptional()
  clientName?: string;

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMenuProductionIngredientVendorDto)
  @IsOptional()
  ingredientVendors?: CreateMenuProductionIngredientVendorDto[];

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  productionDate: string;
}
