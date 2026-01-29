import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, CategoryDocument } from './schemas/category.schema';

export type CreateCategoryInput = {
  name: string;
  isActive?: boolean;
};

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export type ListCategoriesQuery = {
  page: number;
  limit: number;
  search?: string;
  isActive?: boolean;
};

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
  ) {}

  async create(input: CreateCategoryInput) {
    try {
      return await this.categoryModel.create(input);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Category name already exists');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateCategoryInput) {
    try {
      const updated = await this.categoryModel.findByIdAndUpdate(id, input, { new: true });
      if (!updated) throw new NotFoundException('Category not found');
      return updated;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Category name already exists');
      }
      throw error;
    }
  }

  async softDelete(id: string) {
    const updated = await this.categoryModel.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Category not found');
    return updated;
  }

  async findById(id: string) {
    const category = await this.categoryModel.findById(id).lean();
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async findAll(query: ListCategoriesQuery) {
    const filter: Record<string, unknown> = {};
    if (query.search) {
      filter.name = new RegExp(this.escapeRegExp(query.search), 'i');
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.categoryModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.categoryModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findByNameInsensitive(name: string) {
    return this.categoryModel
      .findOne({ name })
      .collation({ locale: 'en', strength: 2 });
  }

  async findOrCreateByName(name: string) {
    const existing = await this.findByNameInsensitive(name);
    if (existing) return existing;

    try {
      return await this.categoryModel.create({ name, isActive: true });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const again = await this.findByNameInsensitive(name);
        if (again) return again;
      }
      throw error;
    }
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
