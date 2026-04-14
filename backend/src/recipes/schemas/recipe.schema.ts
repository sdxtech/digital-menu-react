import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RecipeDocument = HydratedDocument<Recipe>;

export type RecipeStatus = 'draft' | 'active';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type RecipeIngredient = {
  productCode?: string;
  name?: string;
  unitOfMeasures?: string;
  qty?: number;
  priceUom?: number;
  foodCost?: number;
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

  @Prop({
    type: [
      {
        productCode: { type: String, trim: true },
        name: { type: String, trim: true },
        unitOfMeasures: { type: String, trim: true },
        qty: { type: Number },
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
