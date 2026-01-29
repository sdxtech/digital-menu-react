import { IsMongoId } from 'class-validator';

export class CategoryIdParamDto {
  @IsMongoId()
  id: string;
}
