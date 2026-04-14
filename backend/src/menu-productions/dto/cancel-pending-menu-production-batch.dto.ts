import { ArrayMinSize, IsArray, IsMongoId } from 'class-validator';

export class CancelPendingMenuProductionBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  menuProductionIds: string[];
}
