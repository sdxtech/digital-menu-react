import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}
