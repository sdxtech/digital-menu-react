import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class PresignDto {
  @IsString()
  @IsNotEmpty()
  contentType: string;

  @IsString()
  @IsOptional()
  prefix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024)
  fileSize?: number;
}
