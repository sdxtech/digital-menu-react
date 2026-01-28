import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PresignDto {
  @IsString()
  @IsNotEmpty()
  contentType: string;

  @IsString()
  @IsOptional()
  prefix?: string;
}
