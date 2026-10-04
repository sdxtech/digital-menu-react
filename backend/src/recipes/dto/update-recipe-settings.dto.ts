import { IsBoolean } from 'class-validator';

export class UpdateRecipeSettingsDto {
  @IsBoolean()
  targetFoodCostRequired: boolean;
}
