import { IsString } from 'class-validator';

export class CreateSiteDto {
  @IsString()
  code: string;

  @IsString()
  name: string;
}
