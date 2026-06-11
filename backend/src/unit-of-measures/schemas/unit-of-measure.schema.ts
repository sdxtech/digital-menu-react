import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UnitOfMeasureDocument = HydratedDocument<UnitOfMeasure>;

@Schema({ timestamps: true })
export class UnitOfMeasure {
  @Prop({ required: true, trim: true, uppercase: true, unique: true, index: true })
  code: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const UnitOfMeasureSchema =
  SchemaFactory.createForClass(UnitOfMeasure);

UnitOfMeasureSchema.index({ name: 1 });
UnitOfMeasureSchema.index({ createdAt: -1 });
