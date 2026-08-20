import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose'; // 🌟 FIXED: Added missing Types module import to resolve errors
import { AppRole } from '../../auth/roles.constants';

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

  @Prop({ select: false })
  lastActivityAt?: Date;

  // 🌟 NEW FIELD: Allows Mongoose to persist your secure recovery tokens safely
  @Prop({ type: String, select: false, index: true })
  resetTokenHash?: string;

  @Prop({ type: Date, select: false, index: true })
  resetTokenExpiresAt?: Date;

  @Prop({
    type: [String],
    enum: Object.values(AppRole),
    required: true,
    default: undefined,
    validate: {
      validator: (roles?: AppRole[]) =>
        Array.isArray(roles) && roles.length > 0,
      message: 'User role is required',
    },
    index: true,
  })
  roles: AppRole[];

  @Prop({ type: [String], default: [] })
  sites: string[];

  @Prop({ type: Types.ObjectId, ref: 'Site', index: true })
  siteId?: Types.ObjectId;

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
