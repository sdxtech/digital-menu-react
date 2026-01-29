import { IsNotEmpty, IsString } from 'class-validator';

export class ImportDto {
  @IsString()
  @IsNotEmpty()
  fileKey: string;
}
