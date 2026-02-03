import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RecipeDocument = HydratedDocument<Recipe>;

export type RecipeStatus = 'draft' | 'active';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type RecipeIngredient = {
  productCode: string;
  name: string;
  unitOfMeasures: string;
  qty: number;
};

@Schema({ timestamps: true })
export class Recipe {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  category: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: Number, default: 0 })
  price: number;

  @Prop({ type: Number, default: 1 })
  portionSize: number;

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
        productCode: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        unitOfMeasures: { type: String, required: true, trim: true },
        qty: { type: Number, required: true },
      },
    ],
    default: [],
  })
  ingredients: RecipeIngredient[];

  @Prop({ type: String, index: true })
  createdBy?: string;
}

export const RecipeSchema = SchemaFactory.createForClass(Recipe);
RecipeSchema.index({ name: 1 });
RecipeSchema.index({ category: 1 });
