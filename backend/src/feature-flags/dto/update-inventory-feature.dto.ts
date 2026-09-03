import { IsBoolean } from 'class-validator';

export class UpdateInventoryFeatureDto {
  @IsBoolean()
  enabled: boolean;
}
