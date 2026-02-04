import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateRawMaterialDto {
  @IsString()
  @IsNotEmpty()
  productCode: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  unitOfMeasures: string;
}
