import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RecipeSettingsDocument = HydratedDocument<RecipeSettings>;

@Schema({ timestamps: true })
export class RecipeSettings {
  @Prop({ required: true, unique: true, default: 'global' })
  key: string;

  @Prop({ type: Boolean, default: true })
  targetFoodCostRequired: boolean;
}

export const RecipeSettingsSchema =
  SchemaFactory.createForClass(RecipeSettings);
