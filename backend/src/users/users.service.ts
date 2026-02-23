import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AppRole, DEFAULT_ROLE } from '../auth/roles.constants';
import { User, UserDocument } from './schemas/user.schema';

type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  roles?: AppRole[];
  sites?: string[];
};

type UpdateUserInput = {
  name?: string;
  email?: string;
  sites?: string[];
};

type ListUsersQuery = {
  page: number;
  limit: number;
  search?: string;
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
      sites: this.normalizeSites(input.sites),
    });

    return created;
  }

  async list(query: ListUsersQuery) {
    const filter: Record<string, unknown> = {};
    if (query.search?.trim()) {
      const text = query.search.trim();
      filter.$or = [
        { name: new RegExp(this.escapeRegExp(text), 'i') },
        { email: new RegExp(this.escapeRegExp(text), 'i') },
      ];
    }

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.userModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async updateById(id: string, input: UpdateUserInput) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    const nextName = input.name?.trim();
    const nextEmail = input.email?.trim().toLowerCase();
    const nextSites = this.normalizeSites(input.sites);
    const hasSitesUpdate = input.sites !== undefined;

    if (!nextName && !nextEmail && !hasSitesUpdate) {
      throw new BadRequestException('No changes provided');
    }

    if (nextEmail && nextEmail !== user.email) {
      const exists = await this.userModel.exists({ email: nextEmail, _id: { $ne: id } });
      if (exists) throw new ConflictException('Email already registered');
      user.email = nextEmail;
    }

    if (nextName) {
      user.name = nextName;
    }
    if (hasSitesUpdate) {
      user.sites = nextSites;
    }

    await user.save();
    return user.toObject();
  }

  async updatePassword(id: string, password: string) {
    const user = await this.userModel.findById(id).select('+passwordHash');
    if (!user) throw new NotFoundException('User not found');

    const trimmed = password.trim();
    if (!trimmed) {
      throw new BadRequestException('Password is required');
    }

    user.passwordHash = await bcrypt.hash(trimmed, 12);
    await user.save();

    return { id: user.id, email: user.email, name: user.name };
  }

  async deleteById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id.');
    }

    const user = await this.userModel.findByIdAndDelete(id);
    if (!user) throw new NotFoundException('User not found');

    return { id: user.id, email: user.email };
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeSites(sites?: string[]) {
    if (!Array.isArray(sites)) return [];
    return sites
      .map((site) => site.trim())
      .filter(Boolean)
      .slice(0, 1);
  }
}
