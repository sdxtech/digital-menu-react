import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RecipeDocument = HydratedDocument<Recipe>;

export type RecipeStatus = 'draft' | 'active';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type RecipeIngredient = {
  ingredientType?: 'IT' | 'NMP';
  productCode?: string;
  name?: string;
  unitOfMeasures?: string;
  qty?: number;
  prodQty?: number;
  prodUomCode?: string;
  srQty?: number;
  srQtyManual?: boolean;
  srUomCode?: string;
  conversionId?: string;
  conversionMultiplier?: number;
  priceUom?: number;
  foodCost?: number;
};

export type RecipeApprovalHistoryEntry = {
  rejectionReason: string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedByEmail?: string;
  rejectedAt: Date;
  resubmissionFeedback?: string;
  resubmittedBy?: string;
  resubmittedByName?: string;
  resubmittedByEmail?: string;
  resubmittedAt?: Date;
};

@Schema({ timestamps: true })
export class Recipe {
  @Prop({
    type: String,
    trim: true,
    unique: true,
    sparse: true,
    index: true,
  })
  recipeCode?: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Number, min: 1, default: 1, index: true })
  version: number;

  @Prop({ type: String, trim: true, index: true })
  versionGroupId?: string;

  @Prop({ type: String, index: true })
  parentRecipeId?: string;

  @Prop({ trim: true, default: '' })
  category: string;

  @Prop({ type: String, trim: true, index: true })
  site?: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ trim: true })
  imageUrl?: string;

  @Prop({ type: Number, default: 0 })
  price: number;

  @Prop({ type: Number, default: 1 })
  portionSize: number;

  @Prop({ type: Number })
  foodCostRecipe?: number;

  @Prop({ enum: ['draft', 'active'], default: 'draft' })
  status: RecipeStatus;

  @Prop({
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  })
  approvalStatus: ApprovalStatus;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ type: Date, index: true })
  deletedAt?: Date;

  @Prop({ type: String, index: true })
  reviewedBy?: string;

  @Prop({ type: String, trim: true })
  reviewedByName?: string;

  @Prop({ type: String, trim: true, lowercase: true })
  reviewedByEmail?: string;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ type: String, trim: true })
  rejectionReason?: string;

  @Prop({
    type: [
      {
        _id: false,
        rejectionReason: { type: String, required: true, trim: true },
        rejectedBy: { type: String, index: true },
        rejectedByName: { type: String, trim: true },
        rejectedByEmail: { type: String, trim: true, lowercase: true },
        rejectedAt: { type: Date, required: true },
        resubmissionFeedback: { type: String, trim: true },
        resubmittedBy: { type: String, index: true },
        resubmittedByName: { type: String, trim: true },
        resubmittedByEmail: { type: String, trim: true, lowercase: true },
        resubmittedAt: { type: Date },
      },
    ],
    default: [],
  })
  approvalHistory: RecipeApprovalHistoryEntry[];

  @Prop({
    type: [
      {
        ingredientType: { type: String, enum: ['IT', 'NMP'] },
        productCode: { type: String, trim: true },
        name: { type: String, trim: true },
        unitOfMeasures: { type: String, trim: true },
        qty: { type: Number },
        prodQty: { type: Number },
        prodUomCode: { type: String, trim: true },
        srQty: { type: Number },
        srQtyManual: { type: Boolean },
        srUomCode: { type: String, trim: true },
        conversionId: { type: String, trim: true },
        conversionMultiplier: { type: Number },
        priceUom: { type: Number },
        foodCost: { type: Number },
      },
    ],
    default: [],
  })
  ingredients: RecipeIngredient[];

  @Prop({ type: String, index: true })
  createdBy?: string;

  @Prop({ type: String, trim: true })
  createdByName?: string;

  @Prop({ type: String, trim: true, lowercase: true })
  createdByEmail?: string;

  @Prop({ type: String, index: true })
  updatedBy?: string;

  @Prop({ type: String, trim: true })
  updatedByName?: string;

  @Prop({ type: String, trim: true, lowercase: true })
  updatedByEmail?: string;
}

export const RecipeSchema = SchemaFactory.createForClass(Recipe);
RecipeSchema.index({ name: 1 });
RecipeSchema.index({ category: 1 });
RecipeSchema.index(
  { versionGroupId: 1, version: 1 },
  {
    unique: true,
    partialFilterExpression: {
      versionGroupId: { $type: 'string' },
      version: { $type: 'number' },
    },
  },
);
