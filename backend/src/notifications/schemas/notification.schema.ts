import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({ timestamps: true })
export class Notification {
  // 🌟 Changed required to false and added a default empty string 
  // so role-based notifications aren't locked to an individual user's ID
  @Prop({ type: String, default: '', index: true })
  userId!: string;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  message!: string;

  // 🌟 ADDED: Site code tracking for multi-tenant boundary matching (e.g., 'S079')
  @Prop({ type: String, required: false, index: true })
  siteCode?: string;

  // 🌟 ADDED: Role targeting so specific dashboard layouts can pull relevant feeds
  @Prop({ type: String, required: false, enum: ['superadmin', 'unit.manager', 'storekeeper', 'chef'] })
  targetUserRole?: string;

  // 🌟 ADDED: Component keys to selectively light up the correct sidebar badge indicators
  @Prop({ type: String, required: false })
  componentKey?: string;

  @Prop({ type: SchemaTypes.Mixed })
  meta?: Record<string, unknown>;

  @Prop({ default: false })
  read!: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);