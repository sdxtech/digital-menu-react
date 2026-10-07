import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateSiteDto {
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

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
