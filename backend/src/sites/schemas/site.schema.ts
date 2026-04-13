import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SiteDocument = HydratedDocument<Site>;

@Schema({ timestamps: true })
export class Site {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, unique: true, index: true })
  code: string;

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const SiteSchema = SchemaFactory.createForClass(Site);
SiteSchema.index({ createdAt: -1 });
