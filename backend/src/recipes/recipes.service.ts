import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { ListRecipesQueryDto } from './dto/list-recipes.query.dto';
import {
  ApprovalStatus,
  Recipe,
  RecipeDocument,
  RecipeIngredient,
} from './schemas/recipe.schema';

@Injectable()
export class RecipesService {
  constructor(
    @InjectModel(Recipe.name) private readonly recipeModel: Model<RecipeDocument>,
  ) {}

  async create(input: CreateRecipeDto, createdBy?: string) {
    const ingredients = (input.ingredients ?? []).map((item) => ({
      productCode: item.productCode.trim(),
      name: item.name.trim(),
      unitOfMeasures: item.unitOfMeasures.trim(),
      qty: item.qty,
    }));

    return this.recipeModel.create({
      name: input.name.trim(),
      category: input.category.trim(),
      description: input.description?.trim(),
      price: input.price ?? 0,
      portionSize: input.portionSize ?? 1,
      status: input.status ?? 'draft',
      approvalStatus: 'pending',
      ingredients,
      createdBy,
    });
  }

  async findAll(query: ListRecipesQueryDto) {
    const filter: Record<string, unknown> = {};

    if (query.search?.trim()) {
      const text = query.search.trim();
      filter.$or = [
        { name: new RegExp(this.escapeRegExp(text), 'i') },
        { category: new RegExp(this.escapeRegExp(text), 'i') },
      ];
    }

    // BACKEND LOGIC: server-side filtering for recipes (search/status/category).
    const statuses = this.parseCsv(query.statuses);
    if (query.status) statuses.push(query.status);
    if (statuses.length) {
      filter.status = { $in: Array.from(new Set(statuses)) };
    }

    if (query.approvalStatus) filter.approvalStatus = query.approvalStatus;

    const categories = this.parseCsv(query.categories);
    if (query.category?.trim()) categories.push(query.category.trim());
    if (categories.length) {
      filter.category = { $in: Array.from(new Set(categories)) };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.recipeModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.recipeModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async setApprovalStatus(id: string, status: ApprovalStatus) {
    // BACKEND LOGIC: approval updates also update recipe status.
    const nextStatus = status === 'approved' ? 'active' : 'draft';
    const updated = await this.recipeModel
      .findByIdAndUpdate(
        id,
        { approvalStatus: status, status: nextStatus },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Recipe not found');
    return updated;
  }

  async bulkCreate(records: Array<Omit<CreateRecipeDto, 'ingredients'> & {
    ingredients?: RecipeIngredient[];
  }>, createdBy?: string) {
    if (!records.length) return [];

    const payload = records.map((record) => ({
      name: record.name.trim(),
      category: record.category.trim(),
      description: record.description?.trim(),
      price: record.price ?? 0,
      portionSize: record.portionSize ?? 1,
      status: record.status ?? 'draft',
      approvalStatus: 'pending',
      ingredients: record.ingredients ?? [],
      createdBy,
    }));

    return this.recipeModel.insertMany(payload, { ordered: false });
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseCsv(value?: string) {
    if (!value?.trim()) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  // BACKEND LOGIC: category list for frontend filters.
  async listCategories() {
    const categories = await this.recipeModel.distinct('category', {
      category: { $ne: '' },
    });
    return (categories ?? [])
      .map((item) => String(item).trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }
}
