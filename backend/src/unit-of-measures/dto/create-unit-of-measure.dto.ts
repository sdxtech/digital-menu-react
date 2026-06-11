import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateUnitOfMeasureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

}
