import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MenuProductionCodeCounterDocument =
  HydratedDocument<MenuProductionCodeCounter>;

@Schema({ collection: 'counters' })
export class MenuProductionCodeCounter {
  @Prop({ required: true, unique: true, index: true, trim: true })
  key: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq: number;
}

export const MenuProductionCodeCounterSchema = SchemaFactory.createForClass(
  MenuProductionCodeCounter,
);
