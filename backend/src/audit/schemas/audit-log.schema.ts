import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({ index: true })
  actorId?: string;

  @Prop({ trim: true, index: true })
  actorName?: string;

  @Prop({ trim: true, lowercase: true, index: true })
  actorEmail?: string;

  @Prop({ trim: true, index: true })
  role?: string;

  @Prop({ trim: true, index: true })
  site?: string;

  @Prop({ required: true, trim: true, index: true })
  module: string;

  @Prop({ required: true, trim: true, index: true })
  action: string;

  @Prop({ required: true, trim: true })
  method: string;

  @Prop({ required: true, trim: true })
  path: string;

  @Prop({ trim: true, index: true })
  targetId?: string;

  @Prop({ required: true, index: true })
  success: boolean;

  @Prop({ required: true })
  statusCode: number;

  @Prop({ trim: true })
  ipAddress?: string;

  @Prop({ trim: true })
  userAgent?: string;

  @Prop({ type: Object })
  details?: Record<string, unknown>;

  createdAt?: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ module: 1, action: 1, createdAt: -1 });
