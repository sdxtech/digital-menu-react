import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RecipeCodeCounterDocument = HydratedDocument<RecipeCodeCounter>;

@Schema({ collection: 'counters' })
export class RecipeCodeCounter {
  @Prop({ required: true, unique: true, index: true, trim: true })
  key: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq: number;
}

export const RecipeCodeCounterSchema =
  SchemaFactory.createForClass(RecipeCodeCounter);
