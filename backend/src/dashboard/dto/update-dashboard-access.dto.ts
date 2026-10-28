import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DASHBOARD_COMPONENTS } from '../dashboard-access.policy';
import type {
  DashboardPolicy,
  AccessDecision,
  DashboardComponent,
} from '../dashboard-access.policy';

class ComponentAccessDto {
  @IsIn(DASHBOARD_COMPONENTS)
  key: DashboardComponent;

  @IsIn(['inherit', 'allow', 'deny'])
  decision: AccessDecision;
}

export class UpdateDashboardAccessDto implements DashboardPolicy {
  @IsIn(['inherit', 'allow', 'deny'])
  dashboard: AccessDecision;

  @IsArray()
  @ArrayMaxSize(DASHBOARD_COMPONENTS.length)
  @ArrayUnique((rule: ComponentAccessDto) => rule.key)
  @ValidateNested({ each: true })
  @Type(() => ComponentAccessDto)
  components: ComponentAccessDto[];

  @IsIn(['inherit', 'all', 'selected'])
  siteMode: DashboardPolicy['siteMode'];

  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  sites: string[];
}
