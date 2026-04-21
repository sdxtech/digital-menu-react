import { IsBoolean } from 'class-validator';

export class SetRecipeActiveDto {
  @IsBoolean()
  isActive: boolean;
}
