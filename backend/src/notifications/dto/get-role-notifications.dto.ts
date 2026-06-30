import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GetRoleNotificationsDto {
  @IsString()
  @IsNotEmpty()
  siteCode!: string;

  @IsString()
  @IsNotEmpty()
  targetUserRole!: string;

  @IsString()
  @IsOptional()
  componentKey?: string;
}