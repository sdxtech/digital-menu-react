import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MenuProductionDocument = HydratedDocument<MenuProduction>;

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type StoreRequestStatus = 'not-requested' | 'requested' | 'fulfilled';

@Schema({ timestamps: true })
export class MenuProduction {
  @Prop({ required: true, trim: true })
  menuName: string;

  @Prop({ required: true, trim: true })
  category: string;

  @Prop({ type: String, trim: true, index: true })
  site?: string;

  @Prop({ type: Number, required: true })
  portion: number;

  @Prop({ required: true, trim: true, index: true })
  productionDate: string;

  @Prop({
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  })
  approvalStatus: ApprovalStatus;

  @Prop({
    enum: ['not-requested', 'requested', 'fulfilled'],
    default: 'not-requested',
    index: true,
  })
  storeRequestStatus: StoreRequestStatus;

  @Prop({ type: String, index: true })
  createdBy?: string;
}

export const MenuProductionSchema =
  SchemaFactory.createForClass(MenuProduction);
MenuProductionSchema.index({ createdAt: -1 });
