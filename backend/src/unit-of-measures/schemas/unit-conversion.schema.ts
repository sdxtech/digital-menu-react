import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UnitConversionDocument = HydratedDocument<UnitConversion>;

@Schema({ timestamps: true })
export class UnitConversion {
  @Prop({ required: true, trim: true, uppercase: true, index: true })
  prodUomCode: string;

  @Prop({ required: true, trim: true, uppercase: true, index: true })
  srUomCode: string;

  @Prop({ required: true, trim: true })
  conversionId: string;

  @Prop({ required: true, type: Number, min: 0 })
  multiplier: number;

  @Prop({ required: true, type: Number, min: 0 })
  ext: number;

  @Prop({ required: true, type: Number, min: 0 })
  weight: number;

  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const UnitConversionSchema =
  SchemaFactory.createForClass(UnitConversion);

UnitConversionSchema.index(
  {
    prodUomCode: 1,
    srUomCode: 1,
    conversionId: 1,
    multiplier: 1,
    ext: 1,
    weight: 1,
  },
  { unique: true },
);
UnitConversionSchema.index({ createdAt: -1 });
