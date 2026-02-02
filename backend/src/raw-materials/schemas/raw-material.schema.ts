import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RawMaterialDocument = HydratedDocument<RawMaterial>;

@Schema({ timestamps: true })
export class RawMaterial {
  @Prop({ required: true, trim: true })
  productCode: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true, unique: true })
  productCodeNormalized: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  unitOfMeasures: string;
}

export const RawMaterialSchema = SchemaFactory.createForClass(RawMaterial);
RawMaterialSchema.index({ createdAt: -1 });
RawMaterialSchema.index({ name: 1 });

