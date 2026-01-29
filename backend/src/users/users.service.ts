import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppRole, DEFAULT_ROLE } from '../auth/roles.constants';
import { User, UserDocument } from './schemas/user.schema';

type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  roles?: AppRole[];
};

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async findByEmail(email: string, withPassword = false) {
    const q = this.userModel.findOne({ email: email.toLowerCase().trim() });
    return withPassword ? q.select('+passwordHash') : q;
  }

  async findById(id: string) {
    return this.userModel.findById(id);
  }

  async create(input: CreateUserInput) {
    const exists = await this.userModel.exists({ email: input.email.toLowerCase().trim() });
    if (exists) throw new ConflictException('Email already registered');

    const created = await this.userModel.create({
      ...input,
      email: input.email.toLowerCase().trim(),
      roles: input.roles?.length ? input.roles : [DEFAULT_ROLE],
    });

    return created;
  }
}
