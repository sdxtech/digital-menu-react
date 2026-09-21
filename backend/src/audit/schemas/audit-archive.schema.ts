import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuditArchiveDocument = HydratedDocument<AuditArchive>;

@Schema({ timestamps: true })
export class AuditArchive {
  @Prop({ required: true, unique: true, index: true })
  year: number;

  @Prop({ required: true, enum: ['processing', 'completed', 'failed'] })
  status: 'processing' | 'completed' | 'failed';

  @Prop({ type: [String], default: [] })
  pdfKeys: string[];

  @Prop({ type: [String], default: [] })
  recipientEmails: string[];

  @Prop({ default: 0 })
  recordCount: number;

  @Prop()
  completedAt?: Date;

  @Prop()
  error?: string;

  updatedAt?: Date;
}

export const AuditArchiveSchema = SchemaFactory.createForClass(AuditArchive);
