import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ImportDto {
  @IsString()
  @IsNotEmpty()
  fileKey: string;

  @IsString()
  @IsOptional()
  fileName?: string;

  @IsString()
  @IsOptional()
  contentType?: string;
}
