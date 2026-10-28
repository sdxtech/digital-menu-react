import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { DASHBOARD_COMPONENTS } from '../dashboard-access.policy';
import type { DashboardPolicy } from '../dashboard-access.policy';

export type DashboardAccessDocument = HydratedDocument<DashboardAccess>;

@Schema({ timestamps: true })
export class DashboardAccess implements DashboardPolicy {
  @Prop({ required: true, enum: ['role', 'user'] })
  targetType: 'role' | 'user';

  @Prop({ required: true })
  targetId: string;

  @Prop({
    type: String,
    required: true,
    enum: ['inherit', 'allow', 'deny'],
    default: 'inherit',
  })
  dashboard: DashboardPolicy['dashboard'];

  @Prop({
    type: [
      {
        _id: false,
        key: { type: String, enum: DASHBOARD_COMPONENTS },
        decision: { type: String, enum: ['inherit', 'allow', 'deny'] },
      },
    ],
    default: [],
  })
  components: DashboardPolicy['components'];

  @Prop({
    type: String,
    required: true,
    enum: ['inherit', 'all', 'selected'],
    default: 'inherit',
  })
  siteMode: DashboardPolicy['siteMode'];

  @Prop({ type: [String], default: [] })
  sites: string[];

  @Prop({ required: true })
  updatedBy: string;
}

export const DashboardAccessSchema =
  SchemaFactory.createForClass(DashboardAccess);
DashboardAccessSchema.index({ targetType: 1, targetId: 1 }, { unique: true });
