import { IsMongoId } from 'class-validator';

export class MenuGroupIdParamDto {
  @IsMongoId()
  id: string;
}
