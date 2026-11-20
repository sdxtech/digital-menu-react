import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class InventoryLine {
  @Prop({ required: true })
  productCode: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  unitOfMeasures: string;

  @Prop({ required: true, type: Number })
  quantity: number;
}
const lineSchema = SchemaFactory.createForClass(InventoryLine);

@Schema({ timestamps: true })
export class InventoryState {
  @Prop({ required: true, unique: true })
  site: string;

  @Prop({ required: true, type: Date })
  activatedAt: Date;

  @Prop({ required: true, default: 0 })
  revision: number;
}
export type InventoryStateDocument = HydratedDocument<InventoryState>;
export const InventoryStateSchema =
  SchemaFactory.createForClass(InventoryState);

export type InventoryEntryKind =
  | 'opening'
  | 'receipt'
  | 'receipt-reversal'
  | 'issue';

@Schema({ timestamps: true })
export class InventoryEntry {
  @Prop({ required: true, index: true })
  site: string;

  @Prop({ required: true })
  sourceKey: string;

  @Prop({
    required: true,
    enum: ['opening', 'receipt', 'receipt-reversal', 'issue'],
  })
  kind: InventoryEntryKind;

  @Prop({ required: true, type: Date })
  occurredAt: Date;

  @Prop({ required: true })
  actor: string;

  @Prop({ type: String })
  supplier?: string;

  @Prop({ type: String })
  reference?: string;

  @Prop({ type: String })
  note?: string;

  @Prop({ type: String })
  payloadHash?: string;

  @Prop({ type: Date })
  reversedAt?: Date;

  @Prop({ type: [lineSchema], required: true })
  lines: InventoryLine[];
}
export type InventoryEntryDocument = HydratedDocument<InventoryEntry>;
export const InventoryEntrySchema =
  SchemaFactory.createForClass(InventoryEntry);
InventoryEntrySchema.index({ site: 1, sourceKey: 1 }, { unique: true });
InventoryEntrySchema.index({ site: 1, occurredAt: -1, _id: -1 });

// The latest issued quantities make corrections a delta, rather than a second issue.
@Schema({ timestamps: true })
export class InventoryIssue {
  @Prop({ type: Boolean, default: false })
  excluded: boolean;

  @Prop({ required: true })
  site: string;

  @Prop({ required: true })
  batchKey: string;

  @Prop({ required: true, type: [String] })
  menuProductionIds: string[];

  @Prop({ required: true, default: 0 })
  revision: number;

  @Prop({ type: [lineSchema], required: true })
  lines: InventoryLine[];
}
export type InventoryIssueDocument = HydratedDocument<InventoryIssue>;
export const InventoryIssueSchema =
  SchemaFactory.createForClass(InventoryIssue);
InventoryIssueSchema.index({ site: 1, batchKey: 1 }, { unique: true });
InventoryIssueSchema.index({ menuProductionIds: 1 });

@Schema({ timestamps: true })
export class InventoryOpeningPreview {
  @Prop({ required: true })
  site: string;

  @Prop({ required: true })
  actorId: string;

  @Prop({ required: true, type: Date })
  expiresAt: Date;

  @Prop({ required: true, type: [lineSchema] })
  lines: InventoryLine[];
}
export type InventoryOpeningPreviewDocument =
  HydratedDocument<InventoryOpeningPreview>;
export const InventoryOpeningPreviewSchema = SchemaFactory.createForClass(
  InventoryOpeningPreview,
);
InventoryOpeningPreviewSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);
