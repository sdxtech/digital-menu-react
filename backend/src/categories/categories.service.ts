import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
  ) {}

  async create(input: CreateCategoryInput, site?: string) {
    const normalizedSite = this.normalizeSite(site);
    const name = input.name.trim();
    const existing = await this.findByNameInsensitive(name, site);
    if (existing) {
      throw new ConflictException('Category name already exists');
    }

    try {
      return await this.categoryModel.create({
        name,
        isActive: input.isActive ?? true,
        ...(normalizedSite ? { site: normalizedSite } : {}),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Category name already exists');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateCategoryInput, site?: string) {
    const trimmedName = input.name?.trim();
    if (trimmedName) {
      const existing = await this.findByNameInsensitive(trimmedName, site);
      if (existing && String(existing._id) !== id) {
        throw new ConflictException('Category name already exists');
      }
    }

    try {
      const normalizedSite = this.normalizeSite(site);
      const updateFields: UpdateCategoryInput & { site?: string } = {
        ...input,
      };
      if (trimmedName) updateFields.name = trimmedName;
      if (normalizedSite) updateFields.site = normalizedSite;

      const filter = this.withSiteFilter({ _id: id }, site);
      const updated = await this.categoryModel.findOneAndUpdate(
        filter,
        updateFields,
        {
          new: true,
        },
      );
      if (!updated) throw new NotFoundException('Category not found');
      return updated;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Category name already exists');
      }
      throw error;
    }
  }

  async softDelete(id: string, site?: string) {
    const filter = this.withSiteFilter({ _id: id }, site);
    const updated = await this.categoryModel.findOneAndUpdate(
      filter,
      { isActive: false },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Category not found');
    return updated;
  }

  async findById(id: string, site?: string) {
    const filter = this.withSiteFilter({ _id: id }, site);
    const category = await this.categoryModel.findOne(filter).lean();
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async findAll(query: ListCategoriesQuery, site?: string) {
    const filter: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];
    const siteFilter = this.buildSiteFilter(site);
    if (Object.keys(siteFilter).length) {
      andFilters.push(siteFilter);
    }
    if (query.search) {
      andFilters.push({
        name: new RegExp(this.escapeRegExp(query.search), 'i'),
      });
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }
    if (andFilters.length) {
      filter.$and = andFilters;
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

  async findByNameInsensitive(name: string, site?: string) {
    const filter = this.withSiteFilter({ name }, site);
    return this.categoryModel
      .findOne(filter)
      .collation({ locale: 'en', strength: 2 });
  }

  async findOrCreateByName(name: string, site?: string) {
    const normalizedSite = this.normalizeSite(site);
    const existing = await this.findByNameInsensitive(name, site);
    if (existing) return existing;

    try {
      return await this.categoryModel.create({
        name: name.trim(),
        isActive: true,
        ...(normalizedSite ? { site: normalizedSite } : {}),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const again = await this.findByNameInsensitive(name, site);
        if (again) return again;
      }
      throw error;
    }
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeSite(site?: string) {
    const trimmed = site?.trim();
    return trimmed ? trimmed : undefined;
  }

  private buildSiteFilter(site?: string) {
    if (!site) return {};
    return {
      $or: [{ site }, { site: { $exists: false } }, { site: '' }],
    };
  }

  private withSiteFilter(filter: Record<string, unknown>, site?: string) {
    const siteFilter = this.buildSiteFilter(site);
    if (!Object.keys(siteFilter).length) return filter;
    if ('$or' in siteFilter) {
      return { $and: [filter, siteFilter] };
    }
    return { ...filter, ...siteFilter };
  }
}
