import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateSiteDto {
  @IsOptional()
  @IsIn(['operational', 'corporate'])
  siteFunction?: 'operational' | 'corporate';

  @IsOptional()
  @IsIn(['own', 'reference'])
  materialSource?: 'own' | 'reference';

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  referenceSiteCodes?: string[];

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
