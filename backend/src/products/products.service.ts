import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Types } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';

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

  async create(input: CreateProductInput) {
    return this.productModel.create(input);
  }

  async update(id: string, input: UpdateProductInput) {
    const updated = await this.productModel.findByIdAndUpdate(id, input, { new: true });
    if (!updated) throw new NotFoundException('Product not found');
    return updated;
  }

  async softDelete(id: string) {
    const updated = await this.productModel.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Product not found');
    return updated;
  }

  async findById(id: string) {
    const product = await this.productModel.findById(id).lean();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async findAll(query: ListProductsQuery) {
    const filter: Record<string, unknown> = {};
    if (query.search) {
      filter.name = new RegExp(this.escapeRegExp(query.search), 'i');
    }
    if (query.categoryId) {
      filter.categoryId = query.categoryId;
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
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

  async findByNameInsensitive(name: string) {
    return this.productModel
      .findOne({ name })
      .collation({ locale: 'en', strength: 2 });
  }

  async findActiveForExport(): Promise<ExportProductRow[]> {
    return this.productModel
      .find({ isActive: true })
      .populate('categoryId', 'name')
      .sort({ createdAt: -1 })
      .lean<ExportProductRow[]>();
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
