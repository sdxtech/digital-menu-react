import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RawMaterialVendorPriceDocument =
  HydratedDocument<RawMaterialVendorPrice>;

@Schema({ timestamps: true })
export class RawMaterialVendorPrice {
  @Prop({ required: true, trim: true })
  productCode: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  productCodeNormalized: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  unitOfMeasures: string;

  @Prop({ required: true, trim: true, lowercase: true })
  unitOfMeasuresNormalized: string;

  @Prop({ required: true, trim: true })
  site: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  siteNormalized: string;

  @Prop({ required: true, trim: true })
  vendor: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  vendorNormalized: string;

  @Prop({ trim: true })
  currency?: string;

  @Prop({ trim: true, lowercase: true })
  currencyNormalized?: string;

  @Prop({ type: Number })
  minimumQuantity?: number;

  @Prop({ type: Number })
  price?: number;

  @Prop({ type: Map, of: String, default: {} })
  extraFields: Record<string, string>;
}

export const RawMaterialVendorPriceSchema = SchemaFactory.createForClass(
  RawMaterialVendorPrice,
);

RawMaterialVendorPriceSchema.index(
  {
    productCodeNormalized: 1,
    siteNormalized: 1,
    vendorNormalized: 1,
    currencyNormalized: 1,
    unitOfMeasuresNormalized: 1,
    minimumQuantity: 1,
  },
  { unique: true },
);
RawMaterialVendorPriceSchema.index({
  productCodeNormalized: 1,
  vendorNormalized: 1,
});
RawMaterialVendorPriceSchema.index({ createdAt: -1 });
