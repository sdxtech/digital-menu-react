import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateMenuProductionDto } from './dto/create-menu-production.dto';
import { ListMenuProductionsQueryDto } from './dto/list-menu-productions.query.dto';
import { Recipe, RecipeDocument } from '../recipes/schemas/recipe.schema';
import {
  ApprovalStatus,
  MenuProduction,
  MenuProductionDocument,
  StoreRequestStatus,
} from './schemas/menu-production.schema';

type StoreRequestIngredient = {
  productCode: string;
  name: string;
  unitOfMeasures: string;
  qty: number;
};

type StoreRequestMenu = {
  id: string;
  menuName: string;
  category: string;
  portion: number;
  productionDate: string;
  approvalStatus: ApprovalStatus;
  storeRequestStatus: StoreRequestStatus;
  portionSize: number;
  ingredients: StoreRequestIngredient[];
  missingRecipe: boolean;
};

type StoreRequestGroup = {
  date: string;
  items: StoreRequestMenu[];
  summary: StoreRequestIngredient[];
  missingRecipes: string[];
};

type TimelineGroup = {
  date: string;
  items: Array<{
    id: string;
    menuName: string;
    category: string;
    portion: number;
    approvalStatus: ApprovalStatus;
  }>;
};

type TimelineStats = {
  approved: number;
  pending: number;
  rejected: number;
  total: number;
};

const DEFAULT_SITE = 'A1';

@Injectable()
export class MenuProductionsService {
  constructor(
    @InjectModel(MenuProduction.name)
    private readonly menuProductionModel: Model<MenuProductionDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
  ) {}

  async create(
    input: CreateMenuProductionDto,
    createdBy?: string,
    site?: string,
  ) {
    const normalizedSite = this.normalizeSite(site);
    return this.menuProductionModel.create({
      menuName: input.menuName.trim(),
      category: input.category.trim(),
      portion: input.portion,
      productionDate: input.productionDate,
      approvalStatus: 'pending',
      storeRequestStatus: 'not-requested',
      createdBy,
      ...(normalizedSite ? { site: normalizedSite } : {}),
    });
  }

  async createMany(
    inputs: CreateMenuProductionDto[],
    createdBy?: string,
    site?: string,
  ) {
    if (!inputs.length) return [];
    const normalizedSite = this.normalizeSite(site);
    const payload = inputs.map((input) => ({
      menuName: input.menuName.trim(),
      category: input.category.trim(),
      portion: input.portion,
      productionDate: input.productionDate,
      approvalStatus: 'pending',
      storeRequestStatus: 'not-requested',
      createdBy,
      ...(normalizedSite ? { site: normalizedSite } : {}),
    }));
    return this.menuProductionModel.insertMany(payload, { ordered: false });
  }

  async findAll(query: ListMenuProductionsQueryDto, site?: string) {
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
          { menuName: new RegExp(this.escapeRegExp(text), 'i') },
          { category: new RegExp(this.escapeRegExp(text), 'i') },
        ],
      });
    }
    if (andFilters.length) {
      filter.$and = andFilters;
    }
    if (query.approvalStatus) filter.approvalStatus = query.approvalStatus;
    if (query.storeRequestStatus)
      filter.storeRequestStatus = query.storeRequestStatus;
    if (query.productionDate) filter.productionDate = query.productionDate;

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.menuProductionModel
        .find(filter)
        .sort({ productionDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.menuProductionModel.countDocuments(filter),
    ]);

    const needsSync = items.some(
      (item) =>
        item.approvalStatus === 'approved' &&
        item.storeRequestStatus === 'not-requested',
    );
    if (needsSync) {
      const syncFilter = this.withSiteFilter(
        { approvalStatus: 'approved', storeRequestStatus: 'not-requested' },
        site,
      );
      await this.menuProductionModel.updateMany(syncFilter, {
        $set: { storeRequestStatus: 'requested' },
      });
      items.forEach((item) => {
        if (
          item.approvalStatus === 'approved' &&
          item.storeRequestStatus === 'not-requested'
        ) {
          item.storeRequestStatus = 'requested';
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
    // BACKEND LOGIC: approval drives store-request status automatically.
    const nextStoreStatus: StoreRequestStatus =
      status === 'approved' ? 'requested' : 'not-requested';
    const filter = this.withSiteFilter({ _id: id }, site);
    const updated = await this.menuProductionModel
      .findOneAndUpdate(
        filter,
        { approvalStatus: status, storeRequestStatus: nextStoreStatus },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Menu production not found');
    return updated;
  }

  async setStoreRequestStatus(
    id: string,
    status: StoreRequestStatus,
    site?: string,
  ) {
    const filter = this.withSiteFilter({ _id: id }, site);
    const item = await this.menuProductionModel.findOne(filter);
    if (!item) throw new NotFoundException('Menu production not found');
    if (status === 'requested') {
      if (item.approvalStatus !== 'approved') {
        throw new BadRequestException('Menu production is not approved yet.');
      }
    }
    if (status === 'fulfilled') {
      if (item.approvalStatus !== 'approved') {
        throw new BadRequestException('Menu production is not approved yet.');
      }
      if (item.storeRequestStatus !== 'requested') {
        throw new BadRequestException(
          'Store request has not been submitted yet.',
        );
      }
    }
    item.storeRequestStatus = status;
    return item.save();
  }

  // BACKEND LOGIC: production timeline grouping + approval stats.
  async buildTimeline(query: ListMenuProductionsQueryDto, site?: string) {
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
          { menuName: new RegExp(this.escapeRegExp(text), 'i') },
          { category: new RegExp(this.escapeRegExp(text), 'i') },
        ],
      });
    }
    if (andFilters.length) {
      filter.$and = andFilters;
    }
    if (query.approvalStatus) filter.approvalStatus = query.approvalStatus;
    if (query.storeRequestStatus)
      filter.storeRequestStatus = query.storeRequestStatus;
    if (query.productionDate) filter.productionDate = query.productionDate;

    const items = await this.menuProductionModel
      .find(filter)
      .sort({ productionDate: 1, createdAt: -1 })
      .lean();

    const grouped = new Map<string, TimelineGroup>();
    items.forEach((item) => {
      const date = item.productionDate;
      const bucket = grouped.get(date) ?? { date, items: [] };
      bucket.items.push({
        id: String(item._id ?? item.id ?? ''),
        menuName: item.menuName,
        category: item.category,
        portion: item.portion,
        approvalStatus: item.approvalStatus,
      });
      grouped.set(date, bucket);
    });

    const groups = Array.from(grouped.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const totalGroups = groups.length;
    const totalPages = Math.max(1, Math.ceil(totalGroups / limit));
    const start = (page - 1) * limit;
    const pagedGroups = groups.slice(start, start + limit);

    const stats: TimelineStats = {
      approved: items.filter((item) => item.approvalStatus === 'approved')
        .length,
      pending: items.filter((item) => item.approvalStatus === 'pending').length,
      rejected: items.filter((item) => item.approvalStatus === 'rejected')
        .length,
      total: items.length,
    };

    return {
      stats,
      items: pagedGroups,
      page,
      limit,
      totalGroups,
      totalPages,
    };
  }

  // BACKEND LOGIC: compute ingredient multipliers + summary for store requests.
  async buildStoreRequestGroups(
    query: ListMenuProductionsQueryDto,
    site?: string,
  ) {
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
          { menuName: new RegExp(this.escapeRegExp(text), 'i') },
          { category: new RegExp(this.escapeRegExp(text), 'i') },
        ],
      });
    }
    if (andFilters.length) {
      filter.$and = andFilters;
    }
    if (query.approvalStatus) filter.approvalStatus = query.approvalStatus;
    if (query.storeRequestStatus)
      filter.storeRequestStatus = query.storeRequestStatus;
    if (query.productionDate) filter.productionDate = query.productionDate;

    const items = await this.menuProductionModel
      .find(filter)
      .sort({ productionDate: 1, createdAt: -1 })
      .lean();

    if (items.length === 0) {
      return { items: [] as StoreRequestGroup[] };
    }

    // Recipes are shared across sites, so use the full recipe list.
    const recipes = await this.recipeModel.find({}).lean();
    const recipeByName = new Map<string, RecipeDocument>();
    recipes.forEach((recipe) => {
      const key = this.normalizeName(recipe.name ?? '');
      if (!key || recipeByName.has(key)) return;
      recipeByName.set(key, recipe);
    });

    const groups = new Map<
      string,
      {
        date: string;
        items: StoreRequestMenu[];
        summaryMap: Map<string, StoreRequestIngredient>;
        missingRecipes: Set<string>;
      }
    >();

    items.forEach((menu) => {
      const date = menu.productionDate;
      const group = groups.get(date) ?? {
        date,
        items: [],
        summaryMap: new Map<string, StoreRequestIngredient>(),
        missingRecipes: new Set<string>(),
      };

      const recipe = recipeByName.get(this.normalizeName(menu.menuName));
      let ingredients: StoreRequestIngredient[] = [];
      let missingRecipe = false;
      let portionSize = 1;

      if (!recipe) {
        missingRecipe = true;
        if (menu.menuName) {
          group.missingRecipes.add(menu.menuName);
        }
      } else {
        portionSize = Number(recipe.portionSize) || 1;
        if (portionSize <= 0) portionSize = 1;
        // BACKEND LOGIC: qty multiplier = requested portions / base portion size.
        const multiplier = Number(menu.portion) / portionSize;

        ingredients = (recipe.ingredients ?? []).map((ingredient) => {
          const productCode = ingredient.productCode?.trim() ?? '';
          const name = ingredient.name?.trim() ?? '';
          const unitOfMeasures = ingredient.unitOfMeasures?.trim() ?? '';
          const baseQty = Number(ingredient.qty);
          const qty = (Number.isFinite(baseQty) ? baseQty : 0) * multiplier;
          const normalizedKey = `${this.normalizeName(
            productCode || name,
          )}__${this.normalizeName(unitOfMeasures)}`;
          const existing = group.summaryMap.get(normalizedKey);
          if (existing) {
            existing.qty += qty;
          } else {
            group.summaryMap.set(normalizedKey, {
              productCode,
              name,
              unitOfMeasures,
              qty,
            });
          }

          return {
            productCode,
            name,
            unitOfMeasures,
            qty,
          };
        });
      }

      group.items.push({
        id: String(menu._id ?? menu.id ?? ''),
        menuName: menu.menuName,
        category: menu.category,
        portion: menu.portion,
        productionDate: menu.productionDate,
        approvalStatus: menu.approvalStatus,
        storeRequestStatus: menu.storeRequestStatus,
        portionSize,
        ingredients,
        missingRecipe,
      });

      groups.set(date, group);
    });

    const grouped = Array.from(groups.values()).map((group) => ({
      date: group.date,
      items: group.items,
      summary: Array.from(group.summaryMap.values()),
      missingRecipes: Array.from(group.missingRecipes.values()),
    }));

    grouped.sort((a, b) => a.date.localeCompare(b.date));

    return { items: grouped };
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeName(value: string) {
    return value ? value.trim().toLowerCase() : '';
  }

  private normalizeSite(site?: string) {
    const trimmed = site?.trim();
    return trimmed ? trimmed : undefined;
  }

  private buildSiteFilter(site?: string) {
    if (!site) return {};
    if (site === DEFAULT_SITE) {
      return {
        $or: [
          { site: DEFAULT_SITE },
          { site: { $exists: false } },
          { site: '' },
        ],
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
