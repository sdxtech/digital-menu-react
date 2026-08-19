import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ClientDocument = HydratedDocument<Client>;

@Schema({ timestamps: true })
export class Client {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, unique: true, index: true })
  clientId: string;

  @Prop({ type: [String], required: true, default: [] })
  siteIds: string[];
}

export const ClientSchema = SchemaFactory.createForClass(Client);
ClientSchema.index({ createdAt: -1 });
