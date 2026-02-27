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
import { UsersService } from '../users/users.service';

type RecipeActor = {
  id?: string;
  name?: string;
  email?: string;
  site?: string;
};

type RecipeAuditFields = {
  createdBy?: string;
  updatedBy?: string;
  createdByName?: string;
  updatedByName?: string;
};

@Injectable()
export class RecipesService {
  constructor(
    @InjectModel(Recipe.name) private readonly recipeModel: Model<RecipeDocument>,
    private readonly users: UsersService,
  ) {}

  async create(input: CreateRecipeDto, actor?: RecipeActor) {
    const ingredients = (input.ingredients ?? []).map((item) => ({
      productCode: item.productCode.trim(),
      name: item.name.trim(),
      unitOfMeasures: item.unitOfMeasures.trim(),
      qty: item.qty,
    }));
    const imageUrl = input.imageUrl?.trim();

    const normalizedSite = this.normalizeSite(actor?.site);
    const createdFields = this.buildActorFields(actor, 'created');
    const updatedFields = this.buildActorFields(actor, 'updated');

    return this.recipeModel.create({
      name: input.name.trim(),
      category: input.category.trim(),
      description: input.description?.trim(),
      imageUrl: imageUrl || undefined,
      price: input.price ?? 0,
      portionSize: input.portionSize ?? 1,
      status: input.status ?? 'draft',
      approvalStatus: 'pending',
      ingredients,
      ...createdFields,
      ...updatedFields,
      ...(normalizedSite ? { site: normalizedSite } : {}),
    });
  }

  async findAll(query: ListRecipesQueryDto, site?: string) {
    const filter: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];
    // Recipes are shared across sites, so we don't apply site scoping.

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
      const syncFilter = {
        approvalStatus: 'approved',
        status: { $ne: 'active' },
      };
      await this.recipeModel.updateMany(syncFilter, { $set: { status: 'active' } });
      items.forEach((item) => {
        if (item.approvalStatus === 'approved' && item.status !== 'active') {
          item.status = 'active';
        }
      });
    }

    await this.attachActorNames(items);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async setApprovalStatus(id: string, status: ApprovalStatus, actor?: RecipeActor) {
    // BACKEND LOGIC: approval updates also update recipe status.
    const nextStatus = status === 'approved' ? 'active' : 'draft';
    const filter = { _id: id };
    const updatedFields = this.buildActorFields(actor, 'updated');
    const updatePayload = {
      approvalStatus: status,
      status: nextStatus,
      ...updatedFields,
    };
    const updated = await this.recipeModel
      .findOneAndUpdate(
        filter,
        updatePayload,
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Recipe not found');
    return updated;
  }

  async bulkCreate(records: Array<Omit<CreateRecipeDto, 'ingredients'> & {
    ingredients?: RecipeIngredient[];
  }>, actor?: RecipeActor) {
    if (!records.length) return [];

    const normalizedSite = this.normalizeSite(actor?.site);
    const createdFields = this.buildActorFields(actor, 'created');
    const updatedFields = this.buildActorFields(actor, 'updated');
    const payload = records.map((record) => ({
      name: record.name.trim(),
      category: record.category.trim(),
      description: record.description?.trim(),
      imageUrl: record.imageUrl?.trim(),
      price: record.price ?? 0,
      portionSize: record.portionSize ?? 1,
      status: record.status ?? 'draft',
      approvalStatus: 'pending',
      ingredients: record.ingredients ?? [],
      ...createdFields,
      ...updatedFields,
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
    const filter = { category: { $ne: '' } };
    const categories = await this.recipeModel.distinct('category', filter);
    return (categories ?? [])
      .map((item) => String(item).trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  private buildActorFields(actor: RecipeActor | undefined, prefix: 'created' | 'updated') {
    if (!actor) return {};
    const fields: Record<string, string> = {};
    if (actor.id) fields[`${prefix}By`] = actor.id;
    if (actor.name) fields[`${prefix}ByName`] = actor.name.trim();
    if (actor.email) fields[`${prefix}ByEmail`] = actor.email.trim().toLowerCase();
    return fields;
  }

  private async attachActorNames(items: RecipeAuditFields[]) {
    const ids = new Set<string>();
    items.forEach((item) => {
      const createdBy = item.createdBy;
      const updatedBy = item.updatedBy;
      const createdByName = item.createdByName;
      const updatedByName = item.updatedByName;
      const hasCreatedName =
        typeof createdByName === 'string' && createdByName.trim().length > 0;
      const hasUpdatedName =
        typeof updatedByName === 'string' && updatedByName.trim().length > 0;
      if (!hasCreatedName && typeof createdBy === 'string' && createdBy) {
        ids.add(createdBy);
      }
      if (!hasUpdatedName && typeof updatedBy === 'string' && updatedBy) {
        ids.add(updatedBy);
      }
    });

    if (ids.size === 0) return;

    const nameMap = await this.users.findNamesByIds(Array.from(ids));
    if (nameMap.size === 0) return;

    items.forEach((item) => {
      const createdByName = item.createdByName;
      const updatedByName = item.updatedByName;
      const hasCreatedName =
        typeof createdByName === 'string' && createdByName.trim().length > 0;
      const hasUpdatedName =
        typeof updatedByName === 'string' && updatedByName.trim().length > 0;

      if (!hasCreatedName && typeof item.createdBy === 'string') {
        const name = nameMap.get(item.createdBy);
        if (name) item.createdByName = name;
      }
      if (!hasUpdatedName && typeof item.updatedBy === 'string') {
        const name = nameMap.get(item.updatedBy);
        if (name) item.updatedByName = name;
      }
    });
  }

  private normalizeSite(site?: string) {
    const trimmed = site?.trim();
    return trimmed ? trimmed : undefined;
  }

  async setImageUrl(id: string, imageUrl: string, actor?: RecipeActor) {
    const updatedFields = this.buildActorFields(actor, 'updated');
    const updatePayload = {
      imageUrl: imageUrl.trim(),
      ...updatedFields,
    };
    const updated = await this.recipeModel
      .findOneAndUpdate(
        { _id: id },
        updatePayload,
        { new: true },
      )
      .lean();

    if (!updated) throw new NotFoundException('Recipe not found');
    return updated;
  }

  async clearImageUrl(id: string, actor?: RecipeActor) {
    const updatedFields = this.buildActorFields(actor, 'updated');
    const updatePayload: Record<string, unknown> = { $unset: { imageUrl: '' } };
    if (Object.keys(updatedFields).length) {
      updatePayload.$set = updatedFields;
    }
    const updated = await this.recipeModel
      .findOneAndUpdate(
        { _id: id },
        updatePayload,
        { new: true },
      )
      .lean();

    if (!updated) throw new NotFoundException('Recipe not found');
    return updated;
  }
}
