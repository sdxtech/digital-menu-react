import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { AppRole, DEFAULT_ROLE } from '../../auth/roles.constants';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ select: false })
  refreshTokenHash?: string;

  @Prop({
    type: [String],
    enum: Object.values(AppRole),
    default: [DEFAULT_ROLE],
    index: true,
  })
  roles: AppRole[];

  @Prop({ type: [String], default: [] })
  sites: string[];

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
