import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MenuProductionDocument = HydratedDocument<MenuProduction>;

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type StoreRequestStatus = 'not-requested' | 'requested' | 'fulfilled';
export type StoreFulfillmentIngredient = {
  productCode?: string;
  name?: string;
  unitOfMeasures?: string;
  plannedQty?: number;
  actualQty?: number;
  varianceQty?: number;
  reason?: string;
};

@Schema({ timestamps: true })
export class MenuProduction {
  @Prop({
    type: String,
    trim: true,
    index: true,
    sparse: true,
  })
  productionCode?: string;

  @Prop({ type: String, trim: true, index: true })
  recipeId?: string;

  @Prop({ type: String, trim: true, index: true })
  recipeCode?: string;

  @Prop({ required: true, trim: true })
  menuName: string;

  @Prop({ required: true, trim: true })
  category: string;

  @Prop({ type: String, trim: true, index: true })
  site?: string;

  @Prop({ type: Number, required: true })
  portion: number;

  @Prop({ type: Number, required: true, min: 0 })
  cost: number;

  @Prop({ required: true, trim: true, index: true })
  productionDate: string;

  @Prop({
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  })
  approvalStatus: ApprovalStatus;

  @Prop({ type: String, trim: true })
  reviewedBy?: string;

  @Prop({
    enum: ['not-requested', 'requested', 'fulfilled'],
    default: 'not-requested',
    index: true,
  })
  storeRequestStatus: StoreRequestStatus;

  @Prop({ type: String, trim: true })
  fulfilledBy?: string;

  @Prop({
    type: [
      {
        productCode: { type: String, trim: true },
        name: { type: String, trim: true },
        unitOfMeasures: { type: String, trim: true },
        plannedQty: { type: Number },
        actualQty: { type: Number },
        varianceQty: { type: Number },
        reason: { type: String, trim: true },
      },
    ],
    default: [],
  })
  storeFulfillmentItems?: StoreFulfillmentIngredient[];

  @Prop({ type: Date })
  storeFulfillmentCompletedAt?: Date;

  @Prop({ type: String, trim: true })
  storeFulfillmentNote?: string;

  @Prop({ type: String, index: true })
  createdBy?: string;
}

export const MenuProductionSchema =
  SchemaFactory.createForClass(MenuProduction);
MenuProductionSchema.index({ createdAt: -1 });
