import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUnitOfMeasureDto {
  @IsOptional()
  @IsString()
  @MaxLength(24)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
