import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResubmitRecipeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  feedback: string;
}
