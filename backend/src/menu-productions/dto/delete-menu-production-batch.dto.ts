import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class DeleteMenuProductionBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true })
  menuProductionIds: string[];

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}
