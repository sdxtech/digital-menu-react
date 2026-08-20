import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateClientDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  clientId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  @IsOptional()
  siteIds?: string[];
}
