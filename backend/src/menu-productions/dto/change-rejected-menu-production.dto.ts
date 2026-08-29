import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateMenuProductionIngredientVendorDto } from './create-menu-production.dto';

export class ChangeRejectedMenuProductionDto {
  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  recipeId: string;

  @IsString()
  @IsNotEmpty()
  group: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  portion: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMenuProductionIngredientVendorDto)
  ingredientVendors: CreateMenuProductionIngredientVendorDto[];
}
