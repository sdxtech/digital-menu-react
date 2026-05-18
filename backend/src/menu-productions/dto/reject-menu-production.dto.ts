import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectMenuProductionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
