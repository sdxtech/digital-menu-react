import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MenuGroupDocument = HydratedDocument<MenuGroup>;

@Schema({ timestamps: true })
export class MenuGroup {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const MenuGroupSchema = SchemaFactory.createForClass(MenuGroup);
MenuGroupSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
MenuGroupSchema.index({ createdAt: -1 });
