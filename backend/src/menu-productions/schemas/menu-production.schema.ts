import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MenuProductionDocument = HydratedDocument<MenuProduction>;

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type StoreRequestStatus =
  | 'not-requested'
  | 'requested'
  | 'fulfilled'
  | 'cancelled';
export type StoreFulfillmentIngredient = {
  productCode?: string;
  name?: string;
  unitOfMeasures?: string;
  plannedQty?: number;
  actualQty?: number;
  varianceQty?: number;
  vendor?: string;
  vendorSite?: string;
  price?: number;
  ingredientCost?: number;
  plannedIngredientCost?: number;
  actualIngredientCost?: number;
  plannedPrice?: number;
  actualPrice?: number;
  variancePrice?: number;
  reason?: string;
};

export type MenuProductionIngredientVendor = {
  ingredientIndex?: number;
  productCode?: string;
  name?: string;
  unitOfMeasures?: string;
  vendor?: string;
  site?: string;
  currency?: string;
  minimumQuantity?: number;
  price?: number;
  ingredientCost?: number;
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

  @Prop({ type: Number, min: 1, default: 1 })
  recipeVersion?: number;

  @Prop({ required: true, trim: true })
  menuName: string;

  @Prop({ required: true, trim: true })
  category: string;

  @Prop({ type: String, trim: true })
  group?: string;

  @Prop({ type: String, trim: true, index: true })
  site?: string;

  @Prop({ type: String, trim: true, index: true })
  clientId?: string;

  @Prop({ type: String, trim: true })
  clientName?: string;

  @Prop({ type: Number, required: true })
  portion: number;

  @Prop({ type: Number, required: true, min: 0 })
  cost: number;

  @Prop({ type: Number, min: 0 })
  estimatedTotalCost?: number;

  @Prop({ type: Number, min: 0 })
  estimatedCostPerPax?: number;

  @Prop({ type: Number, min: 0 })
  sellingPricePerPax?: number;

  @Prop({ type: Number, min: 0 })
  sellingQuantity?: number;

  @Prop({ type: Number, min: 0 })
  estimatedRevenue?: number;

  @Prop({ type: String, trim: true })
  salesInputBy?: string;

  @Prop({
    type: [
      {
        ingredientIndex: { type: Number },
        productCode: { type: String, trim: true },
        name: { type: String, trim: true },
        unitOfMeasures: { type: String, trim: true },
        vendor: { type: String, trim: true },
        site: { type: String, trim: true },
        currency: { type: String, trim: true },
        minimumQuantity: { type: Number },
        price: { type: Number },
        ingredientCost: { type: Number },
      },
    ],
    default: [],
  })
  ingredientVendors?: MenuProductionIngredientVendor[];

  @Prop({ required: true, trim: true, index: true })
  productionDate: string;

  @Prop({
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  })
  approvalStatus: ApprovalStatus;

  @Prop({ type: Boolean, default: false, index: true })
  isDraft: boolean;

  @Prop({ type: Date, index: true })
  submittedAt?: Date;

  @Prop({ type: String, trim: true })
  reviewedBy?: string;

  @Prop({ type: Date })
  approvedAt?: Date;

  @Prop({ type: String, trim: true })
  rejectionReason?: string;

  @Prop({ type: String, trim: true, index: true })
  unitManagerId?: string;

  @Prop({ type: String, trim: true })
  assistedBy?: string;

  @Prop({
    enum: ['not-requested', 'requested', 'fulfilled', 'cancelled'],
    default: 'not-requested',
    index: true,
  })
  storeRequestStatus: StoreRequestStatus;

  @Prop({ type: String, trim: true })
  fulfilledBy?: string;

  @Prop({ type: String, trim: true })
  storeCancelledBy?: string;

  @Prop({
    type: [
      {
        productCode: { type: String, trim: true },
        name: { type: String, trim: true },
        unitOfMeasures: { type: String, trim: true },
        plannedQty: { type: Number },
        actualQty: { type: Number },
        varianceQty: { type: Number },
        vendor: { type: String, trim: true },
        vendorSite: { type: String, trim: true },
        price: { type: Number },
        ingredientCost: { type: Number },
        plannedIngredientCost: { type: Number },
        actualIngredientCost: { type: Number },
        plannedPrice: { type: Number },
        actualPrice: { type: Number },
        variancePrice: { type: Number },
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

  @Prop({ type: Date })
  storeCancelledAt?: Date;

  @Prop({ type: String, trim: true })
  storeCancellationReason?: string;

  @Prop({ type: String, index: true })
  createdBy?: string;
}

export const MenuProductionSchema =
  SchemaFactory.createForClass(MenuProduction);
MenuProductionSchema.index({ createdAt: -1 });
