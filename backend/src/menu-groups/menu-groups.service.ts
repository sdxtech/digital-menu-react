import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuGroup, MenuGroupDocument } from './schemas/menu-group.schema';

export type CreateMenuGroupInput = {
  name: string;
  isActive?: boolean;
};

export type UpdateMenuGroupInput = Partial<CreateMenuGroupInput>;

export type ListMenuGroupsQuery = {
  page: number;
  limit: number;
  search?: string;
  isActive?: boolean;
};

@Injectable()
export class MenuGroupsService {
  constructor(
    @InjectModel(MenuGroup.name)
    private readonly menuGroupModel: Model<MenuGroupDocument>,
  ) {}

  async create(input: CreateMenuGroupInput) {
    const name = input.name.trim();
    const existing = await this.findByNameInsensitive(name);
    if (existing) {
      throw new ConflictException('Group By name already exists');
    }

    try {
      return await this.menuGroupModel.create({
        name,
        isActive: input.isActive ?? true,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Group By name already exists');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateMenuGroupInput) {
    const updateFields: UpdateMenuGroupInput = { ...input };
    if (input.name !== undefined) {
      const name = input.name.trim();
      const existing = await this.findByNameInsensitive(name);
      if (existing && String(existing._id) !== id) {
        throw new ConflictException('Group By name already exists');
      }
      updateFields.name = name;
    }

    try {
      const updated = await this.menuGroupModel.findByIdAndUpdate(
        id,
        updateFields,
        { new: true },
      );
      if (!updated) throw new NotFoundException('Group By option not found');
      return updated;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Group By name already exists');
      }
      throw error;
    }
  }

  async findAll(query: ListMenuGroupsQuery) {
    const filter: Record<string, unknown> = {};
    if (query.search?.trim()) {
      filter.name = new RegExp(this.escapeRegExp(query.search.trim()), 'i');
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.menuGroupModel
        .find(filter)
        .sort({ name: 1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.menuGroupModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  private findByNameInsensitive(name: string) {
    return this.menuGroupModel
      .findOne({ name })
      .collation({ locale: 'en', strength: 2 });
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
