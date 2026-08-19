import { ArrayMinSize, IsArray, IsMongoId, IsString } from 'class-validator';

export class CreateClientDto {
  @IsString()
  name: string;

  @IsString()
  clientId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  siteIds: string[];
}
