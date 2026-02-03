import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateMenuProductionDto } from './create-menu-production.dto';

export class CreateMenuProductionBulkDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMenuProductionDto)
  items: CreateMenuProductionDto[];
}
