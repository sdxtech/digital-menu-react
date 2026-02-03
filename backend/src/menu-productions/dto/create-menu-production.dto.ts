import { IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMenuProductionDto {
  @IsString()
  @IsNotEmpty()
  menuName: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  portion: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  productionDate: string;
}
