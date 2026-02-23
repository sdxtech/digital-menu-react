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

const DEFAULT_SITE = 'A1';

@Injectable()
export class RecipesService {
  constructor(
    @InjectModel(Recipe.name) private readonly recipeModel: Model<RecipeDocument>,
  ) {}

  async create(input: CreateRecipeDto, createdBy?: string, site?: string) {
    const ingredients = (input.ingredients ?? []).map((item) => ({
      productCode: item.productCode.trim(),
      name: item.name.trim(),
      unitOfMeasures: item.unitOfMeasures.trim(),
      qty: item.qty,
    }));

    const normalizedSite = this.normalizeSite(site);

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
      ...(normalizedSite ? { site: normalizedSite } : {}),
    });
  }

  async findAll(query: ListRecipesQueryDto, site?: string) {
    const filter: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];
    const siteFilter = this.buildSiteFilter(site);
    if (Object.keys(siteFilter).length) {
      andFilters.push(siteFilter);
    }

    if (query.search?.trim()) {
      const text = query.search.trim();
      andFilters.push({
        $or: [
          { name: new RegExp(this.escapeRegExp(text), 'i') },
          { category: new RegExp(this.escapeRegExp(text), 'i') },
        ],
      });
    }

    if (andFilters.length) {
      filter.$and = andFilters;
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

    const needsSync = items.some(
      (item) =>
        item.approvalStatus === 'approved' && item.status !== 'active',
    );
    if (needsSync) {
      const syncFilter = this.withSiteFilter(
        { approvalStatus: 'approved', status: { $ne: 'active' } },
        site,
      );
      await this.recipeModel.updateMany(syncFilter, { $set: { status: 'active' } });
      items.forEach((item) => {
        if (item.approvalStatus === 'approved' && item.status !== 'active') {
          item.status = 'active';
        }
      });
    }

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async setApprovalStatus(id: string, status: ApprovalStatus, site?: string) {
    // BACKEND LOGIC: approval updates also update recipe status.
    const nextStatus = status === 'approved' ? 'active' : 'draft';
    const filter = this.withSiteFilter({ _id: id }, site);
    const updated = await this.recipeModel
      .findOneAndUpdate(
        filter,
        { approvalStatus: status, status: nextStatus },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Recipe not found');
    return updated;
  }

  async bulkCreate(records: Array<Omit<CreateRecipeDto, 'ingredients'> & {
    ingredients?: RecipeIngredient[];
  }>, createdBy?: string, site?: string) {
    if (!records.length) return [];

    const normalizedSite = this.normalizeSite(site);
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
      ...(normalizedSite ? { site: normalizedSite } : {}),
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
  async listCategories(site?: string) {
    const filter = this.withSiteFilter({ category: { $ne: '' } }, site);
    const categories = await this.recipeModel.distinct('category', filter);
    return (categories ?? [])
      .map((item) => String(item).trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
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
