import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Types } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';

const DEFAULT_SITE = 'A1';

export type CreateProductInput = {
  name: string;
  price: number;
  categoryId?: Types.ObjectId | string;
  description?: string;
  imageUrl?: string;
  isActive?: boolean;
};

export type UpdateProductInput = Partial<CreateProductInput>;

export type ListProductsQuery = {
  page: number;
  limit: number;
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  sortBy: 'createdAt' | 'price' | 'name';
  sortDir: 'asc' | 'desc';
};

export type ExportProductRow = {
  name: string;
  price: number;
  categoryId?: { name?: string } | null;
  description?: string | null;
  imageUrl?: string | null;
};

@Injectable()
export class ProductsService {
  constructor(@InjectModel(Product.name) private readonly productModel: Model<ProductDocument>) {}

  async create(input: CreateProductInput, site?: string) {
    const normalizedSite = this.normalizeSite(site);
    return this.productModel.create({
      name: input.name.trim(),
      price: input.price,
      categoryId: input.categoryId,
      description: input.description?.trim(),
      imageUrl: input.imageUrl?.trim(),
      isActive: input.isActive ?? true,
      ...(normalizedSite ? { site: normalizedSite } : {}),
    });
  }

  async update(id: string, input: UpdateProductInput, site?: string) {
    const normalizedSite = this.normalizeSite(site);
    const updateFields: UpdateProductInput & { site?: string } = {
      ...input,
    };
    if (updateFields.name) updateFields.name = updateFields.name.trim();
    if (updateFields.description) updateFields.description = updateFields.description.trim();
    if (updateFields.imageUrl) updateFields.imageUrl = updateFields.imageUrl.trim();
    if (normalizedSite) updateFields.site = normalizedSite;

    const filter = this.withSiteFilter({ _id: id }, site);
    const updated = await this.productModel.findOneAndUpdate(filter, updateFields, {
      new: true,
    });
    if (!updated) throw new NotFoundException('Product not found');
    return updated;
  }

  async softDelete(id: string, site?: string) {
    const filter = this.withSiteFilter({ _id: id }, site);
    const updated = await this.productModel.findOneAndUpdate(
      filter,
      { isActive: false },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Product not found');
    return updated;
  }

  async findById(id: string, site?: string) {
    const filter = this.withSiteFilter({ _id: id }, site);
    const product = await this.productModel.findOne(filter).lean();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async findAll(query: ListProductsQuery, site?: string) {
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
    if (query.categoryId) {
      filter.categoryId = query.categoryId;
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }
    if (andFilters.length) {
      filter.$and = andFilters;
    }

    const sortDir = query.sortDir === 'asc' ? 1 : -1;
    const sortField = query.sortBy || 'createdAt';
    const sort = { [sortField]: sortDir } as Record<string, 1 | -1>;
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await Promise.all([
      this.productModel.find(filter).sort(sort).skip(skip).limit(query.limit).lean(),
      this.productModel.countDocuments(filter),
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
    return this.productModel.findOne(filter).collation({ locale: 'en', strength: 2 });
  }

  async findActiveForExport(site?: string): Promise<ExportProductRow[]> {
    const filter = this.withSiteFilter({ isActive: true }, site);
    return this.productModel
      .find(filter)
      .populate('categoryId', 'name')
      .sort({ createdAt: -1 })
      .lean<ExportProductRow[]>();
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
    if (site === DEFAULT_SITE) {
      return {
        $or: [{ site: DEFAULT_SITE }, { site: { $exists: false } }, { site: '' }],
      };
    }
    return { site };
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
