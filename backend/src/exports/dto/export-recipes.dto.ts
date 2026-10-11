import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ExportRecipesDto {
  @IsIn(['selected', 'all'])
  mode: 'selected' | 'all';

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10000)
  @IsMongoId({ each: true })
  ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10000)
  @IsMongoId({ each: true })
  excludedIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  site?: string;
}
