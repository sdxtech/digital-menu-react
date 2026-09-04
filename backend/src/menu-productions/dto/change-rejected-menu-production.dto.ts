import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateMenuProductionIngredientVendorDto } from './create-menu-production.dto';

export class ChangeRejectedMenuProductionDto {
  @IsOptional()
  @IsIn(['all', 'group', 'menu', 'portion'])
  scope?: 'all' | 'group' | 'menu' | 'portion';

  @ValidateIf((input: ChangeRejectedMenuProductionDto) =>
    ['all', 'menu'].includes(input.scope ?? 'all'),
  )
  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  recipeId?: string;

  @ValidateIf((input: ChangeRejectedMenuProductionDto) =>
    ['all', 'group'].includes(input.scope ?? 'all'),
  )
  @IsString()
  @IsNotEmpty()
  group?: string;

  @ValidateIf((input: ChangeRejectedMenuProductionDto) =>
    ['all', 'portion'].includes(input.scope ?? 'all'),
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  portion?: number;

  @ValidateIf((input: ChangeRejectedMenuProductionDto) =>
    ['all', 'menu'].includes(input.scope ?? 'all'),
  )
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMenuProductionIngredientVendorDto)
  ingredientVendors?: CreateMenuProductionIngredientVendorDto[];
}
