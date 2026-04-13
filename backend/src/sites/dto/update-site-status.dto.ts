import { IsBoolean } from 'class-validator';

export class UpdateSiteStatusDto {
  @IsBoolean()
  isActive: boolean;
}
