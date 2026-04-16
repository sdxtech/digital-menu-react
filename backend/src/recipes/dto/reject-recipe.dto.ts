import { IsString, MaxLength } from 'class-validator';

export class RejectRecipeDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}
