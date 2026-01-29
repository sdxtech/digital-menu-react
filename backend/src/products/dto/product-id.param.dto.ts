import { IsMongoId } from 'class-validator';

export class ProductIdParamDto {
  @IsMongoId()
  id: string;
}
