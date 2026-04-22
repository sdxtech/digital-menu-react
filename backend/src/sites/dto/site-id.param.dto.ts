import { IsMongoId } from 'class-validator';

export class SiteIdParamDto {
  @IsMongoId()
  id: string;
}
