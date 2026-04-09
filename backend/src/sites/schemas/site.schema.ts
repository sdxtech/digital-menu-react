import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SiteDocument = HydratedDocument<Site>;

@Schema({ timestamps: true })
export class Site {
  @Prop({
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    index: true,
  })
  code: string;

  @Prop({
    required: true,
    unique: true,
    trim: true,
    index: true,
  })
  name: string;

  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const SiteSchema = SchemaFactory.createForClass(Site);
