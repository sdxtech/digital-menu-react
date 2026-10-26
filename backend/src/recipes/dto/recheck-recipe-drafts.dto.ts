import { IsMongoId, IsOptional } from 'class-validator';

export class RecheckRecipeDraftsDto {
  @IsOptional()
  @IsMongoId()
  afterId?: string;
}
