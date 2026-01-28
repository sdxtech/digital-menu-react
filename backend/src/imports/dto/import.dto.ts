import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ImportDto {
  @IsString()
  @IsNotEmpty()
  fileKey: string;

  @IsString()
  @IsIn(['products', 'users', 'categories'])
  kind: 'products' | 'users' | 'categories';
}
