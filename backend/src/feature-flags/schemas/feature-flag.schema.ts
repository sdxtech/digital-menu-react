import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FeatureFlagDocument = HydratedDocument<FeatureFlag>;

@Schema({ timestamps: true })
export class FeatureFlag {
  @Prop({ required: true, trim: true, unique: true })
  key: string;

  @Prop({ required: true, default: true })
  enabled: boolean;
}

export const FeatureFlagSchema = SchemaFactory.createForClass(FeatureFlag);
