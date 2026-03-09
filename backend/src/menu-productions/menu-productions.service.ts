import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateMenuProductionDto } from './dto/create-menu-production.dto';
import { ListMenuProductionsQueryDto } from './dto/list-menu-productions.query.dto';
import { Recipe, RecipeDocument } from '../recipes/schemas/recipe.schema';
import {
  MenuProductionCodeCounter,
  MenuProductionCodeCounterDocument,
} from './schemas/menu-production-code-counter.schema';
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
  site?: string;
  productionCode?: string;
  recipeId?: string;
  recipeCode?: string;
  menuName: string;
  category: string;
  portion: number;
  productionDate: string;
  approvalStatus: ApprovalStatus;
  storeRequestStatus: StoreRequestStatus;
  portionSize: number;
  ingredients: StoreRequestIngredient[];
  missingRecipe: boolean;
  fulfilledBy?: string;
};

type StoreRequestGroup = {
  site?: string;
  date: string;
  productionCode?: string;
  items: StoreRequestMenu[];
  summary: StoreRequestIngredient[];
  missingRecipes: string[];
};

type TimelineGroup = {
  date: string;
  productionCode?: string;
  items: Array<{
    id: string;
    productionCode?: string;
    recipeId?: string;
    recipeCode?: string;
    menuName: string;
    category: string;
    portion: number;
    approvalStatus: ApprovalStatus;
    reviewedBy?: string;
  }>;
};

type TimelineStats = {
  approved: number;
  pending: number;
  rejected: number;
  total: number;
};

type EligibleRecipe = {
  id: string;
  recipeCode?: string;
  name: string;
  category: string;
};

const DEFAULT_SITE = 'A1';
const MENU_PRODUCTION_CODE_PREFIX = 'MPR';
const MENU_PRODUCTION_CODE_MIN_DIGITS = 4;
const MENU_PRODUCTION_CODE_COUNTER_KEY = 'menu_production_code';

@Injectable()
export class MenuProductionsService implements OnModuleInit {
  private readonly logger = new Logger(MenuProductionsService.name);

  constructor(
    @InjectModel(MenuProduction.name)
    private readonly menuProductionModel: Model<MenuProductionDocument>,
    @InjectModel(MenuProductionCodeCounter.name)
    private readonly menuProductionCodeCounterModel: Model<MenuProductionCodeCounterDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureNonUniqueProductionCodeIndex();
  }

  async create(
    input: CreateMenuProductionDto,
    createdBy?: string,
    site?: string,
  ) {
    const recipeById = await this.findEligibleRecipesById([input.recipeId]);
    const normalizedRecipeId = this.normalizeRecipeId(input.recipeId);
    const recipe = recipeById.get(normalizedRecipeId);
    if (!recipe) {
      throw new BadRequestException(
        `Only approved recipes can be used for menu production. Not eligible recipe id: ${normalizedRecipeId}.`,
      );
    }
    const productionCode = await this.nextMenuProductionCode();

    const normalizedSite = this.normalizeSite(site);
    return this.menuProductionModel.create({
      productionCode,
      recipeId: recipe.id,
      recipeCode: recipe.recipeCode,
      menuName: recipe.name,
      category: recipe.category,
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
    const normalizedInputs = inputs.map((input) => ({
      ...input,
      recipeId: this.normalizeRecipeId(input.recipeId),
      productionDate: input.productionDate.trim(),
    }));
    const recipeById = await this.findEligibleRecipesById(
      normalizedInputs.map((item) => item.recipeId),
    );

    const normalizedSite = this.normalizeSite(site);
    const uniqueDates = Array.from(
      new Set(normalizedInputs.map((item) => item.productionDate)),
    );
    const productionCodes = await this.allocateMenuProductionCodes(
      uniqueDates.length,
    );
    const productionCodeByDate = new Map(
      uniqueDates.map((date, index) => [date, productionCodes[index]]),
    );
    const payload = normalizedInputs.map((input) => {
      const recipe = recipeById.get(input.recipeId);
      if (!recipe) {
        throw new BadRequestException(
          `Only approved recipes can be used for menu production. Not eligible recipe id: ${input.recipeId}.`,
        );
      }

      return {
        productionCode: productionCodeByDate.get(input.productionDate),
        recipeId: recipe.id,
        recipeCode: recipe.recipeCode,
        menuName: recipe.name,
        category: recipe.category,
        portion: input.portion,
        productionDate: input.productionDate,
        approvalStatus: 'pending',
        storeRequestStatus: 'not-requested',
        createdBy,
        ...(normalizedSite ? { site: normalizedSite } : {}),
      };
    });
    return this.menuProductionModel.insertMany(payload, { ordered: false });
  }

  async findAll(query: ListMenuProductionsQueryDto, site?: string) {
    await this.backfillMissingMenuProductionCodes();

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
          { productionCode: new RegExp(this.escapeRegExp(text), 'i') },
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

  async setApprovalStatus(
    id: string,
    status: ApprovalStatus,
    site?: string,
    reviewedBy?: string,
  ) {
    // BACKEND LOGIC: approval drives store-request status automatically.
    const nextStoreStatus: StoreRequestStatus =
      status === 'approved' ? 'requested' : 'not-requested';
    const actor = reviewedBy?.trim();
    const filter = this.withSiteFilter({ _id: id }, site);
    const updated = await this.menuProductionModel
      .findOneAndUpdate(
        filter,
        {
          $set: {
            approvalStatus: status,
            storeRequestStatus: nextStoreStatus,
            ...(actor ? { reviewedBy: actor } : {}),
          },
          $unset: { fulfilledBy: 1 },
        },
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
    fulfilledBy?: string,
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
    if (status === 'fulfilled') {
      const actor = fulfilledBy?.trim();
      item.fulfilledBy = actor || 'Unknown user';
    } else {
      item.fulfilledBy = undefined;
    }
    return item.save();
  }

  // BACKEND LOGIC: production timeline grouping + approval stats.
  async buildTimeline(query: ListMenuProductionsQueryDto, site?: string) {
    await this.backfillMissingMenuProductionCodes();

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
          { productionCode: new RegExp(this.escapeRegExp(text), 'i') },
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

    const recipeIds = Array.from(
      new Set(
        items
          .map((item) => this.normalizeOptionalRecipeId(item.recipeId))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const recipeCodeById = new Map<string, string>();
    if (recipeIds.length) {
      const recipes = await this.recipeModel
        .find({ _id: { $in: recipeIds } })
        .select({ recipeCode: 1 })
        .lean();
      recipes.forEach((recipe) => {
        const normalizedRecipeId = this.normalizeOptionalRecipeId(
          String(recipe._id ?? ''),
        );
        const recipeCode = this.normalizeOptionalRecipeCode(recipe.recipeCode);
        if (!normalizedRecipeId || !recipeCode) return;
        recipeCodeById.set(normalizedRecipeId, recipeCode);
      });
    }

    const grouped = new Map<string, TimelineGroup>();
    items.forEach((item) => {
      const date = item.productionDate;
      const groupKey = this.buildProductionBatchKey({
        productionDate: date,
        productionCode: item.productionCode,
        id: String(item._id ?? item.id ?? ''),
      });
      const bucket = grouped.get(groupKey) ?? {
        date,
        productionCode: this.normalizeOptionalProductionCode(
          item.productionCode,
        ),
        items: [],
      };
      const recipeId = this.normalizeOptionalRecipeId(item.recipeId);
      bucket.items.push({
        id: String(item._id ?? item.id ?? ''),
        productionCode: item.productionCode,
        recipeId,
        recipeCode:
          this.normalizeOptionalRecipeCode(item.recipeCode) ??
          (recipeId ? recipeCodeById.get(recipeId) : undefined),
        menuName: item.menuName,
        category: item.category,
        portion: item.portion,
        approvalStatus: item.approvalStatus,
        reviewedBy: item.reviewedBy,
      });
      grouped.set(groupKey, bucket);
    });

    const groups = Array.from(grouped.values()).sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return (a.productionCode ?? '').localeCompare(b.productionCode ?? '');
    });

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
    await this.backfillMissingMenuProductionCodes();
    const requestedSite = this.normalizeSite(site);

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
          { productionCode: new RegExp(this.escapeRegExp(text), 'i') },
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
    const productionDateFilter = this.buildProductionDateFilter(query);
    if (productionDateFilter) {
      filter.productionDate = productionDateFilter;
    }

    const items = await this.menuProductionModel
      .find(filter)
      .sort({ productionDate: 1, createdAt: -1 })
      .lean();

    if (items.length === 0) {
      return { items: [] as StoreRequestGroup[] };
    }

    // Recipes are shared across sites, so use the full recipe list.
    const recipes = await this.recipeModel.find({}).lean();
    const recipeById = new Map<string, RecipeDocument>();
    const recipeByName = new Map<string, RecipeDocument>();
    recipes.forEach((recipe) => {
      const recipeId = this.normalizeOptionalRecipeId(String(recipe._id ?? ''));
      if (recipeId) {
        recipeById.set(recipeId, recipe);
      }
      const key = this.normalizeName(recipe.name ?? '');
      if (!key || recipeByName.has(key)) return;
      recipeByName.set(key, recipe);
    });

    const groups = new Map<
      string,
      {
        site?: string;
        date: string;
        productionCode?: string;
        items: StoreRequestMenu[];
        summaryMap: Map<string, StoreRequestIngredient>;
        missingRecipes: Set<string>;
      }
    >();

    items.forEach((menu) => {
      const date = menu.productionDate;
      const groupKey = this.buildProductionBatchKey({
        productionDate: date,
        productionCode: menu.productionCode,
        id: String(menu._id ?? menu.id ?? ''),
      });
      const group = groups.get(groupKey) ?? {
        site: this.normalizeSite(menu.site) ?? requestedSite ?? DEFAULT_SITE,
        date,
        productionCode: this.normalizeOptionalProductionCode(
          menu.productionCode,
        ),
        items: [],
        summaryMap: new Map<string, StoreRequestIngredient>(),
        missingRecipes: new Set<string>(),
      };

      const menuRecipeId = this.normalizeOptionalRecipeId(menu.recipeId);
      const recipe =
        (menuRecipeId ? recipeById.get(menuRecipeId) : undefined) ??
        recipeByName.get(this.normalizeName(menu.menuName));
      let ingredients: StoreRequestIngredient[] = [];
      let missingRecipe = false;
      let portionSize = 1;
      const resolvedRecipeId =
        menuRecipeId ??
        (recipe
          ? this.normalizeOptionalRecipeId(String(recipe._id ?? ''))
          : undefined);
      const resolvedRecipeCode =
        this.normalizeOptionalRecipeCode(menu.recipeCode) ??
        this.normalizeOptionalRecipeCode(recipe?.recipeCode);

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
        site: this.normalizeSite(menu.site) ?? group.site,
        productionCode: menu.productionCode,
        recipeId: resolvedRecipeId,
        recipeCode: resolvedRecipeCode,
        menuName: menu.menuName,
        category: menu.category,
        portion: menu.portion,
        productionDate: menu.productionDate,
        approvalStatus: menu.approvalStatus,
        storeRequestStatus: menu.storeRequestStatus,
        portionSize,
        ingredients,
        missingRecipe,
        fulfilledBy: menu.fulfilledBy,
      });

      groups.set(groupKey, group);
    });

    const grouped = Array.from(groups.values()).map((group) => ({
      site: group.site,
      date: group.date,
      productionCode: group.productionCode,
      items: group.items,
      summary: Array.from(group.summaryMap.values()),
      missingRecipes: Array.from(group.missingRecipes.values()),
    }));

    grouped.sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return (a.productionCode ?? '').localeCompare(b.productionCode ?? '');
    });

    return { items: grouped };
  }

  async listStoreRequestSites() {
    const [rawSites, hasLegacyDefaultSiteRows] = await Promise.all([
      this.menuProductionModel.distinct('site', { approvalStatus: 'approved' }),
      this.menuProductionModel.exists({
        approvalStatus: 'approved',
        $or: [{ site: { $exists: false } }, { site: '' }],
      }),
    ]);

    const normalized = rawSites
      .map((site) => String(site).trim())
      .filter(Boolean);

    if (hasLegacyDefaultSiteRows) {
      normalized.push(DEFAULT_SITE);
    }

    return Array.from(new Set(normalized)).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }

  private async findEligibleRecipesById(
    recipeIds: string[],
  ): Promise<Map<string, EligibleRecipe>> {
    const normalizedIds = Array.from(
      new Set(recipeIds.map((recipeId) => this.normalizeRecipeId(recipeId))),
    );
    if (normalizedIds.length === 0) {
      throw new BadRequestException(
        'Menu production requires a valid approved recipe.',
      );
    }

    const recipes = await this.recipeModel
      .find({
        _id: { $in: normalizedIds },
        approvalStatus: 'approved',
        status: 'active',
      })
      .select({ recipeCode: 1, name: 1, category: 1 })
      .lean();

    const byId = new Map<string, EligibleRecipe>();
    recipes.forEach((recipe) => {
      const normalizedRecipeId = this.normalizeOptionalRecipeId(
        String(recipe._id ?? ''),
      );
      if (!normalizedRecipeId) return;
      byId.set(normalizedRecipeId, {
        id: normalizedRecipeId,
        recipeCode: this.normalizeOptionalRecipeCode(recipe.recipeCode),
        name: recipe.name?.trim() ?? '',
        category: recipe.category?.trim() ?? '',
      });
    });

    const missingIds = normalizedIds.filter((id) => !byId.has(id));
    if (missingIds.length) {
      throw new BadRequestException(
        `Only approved recipes can be used for menu production. Not eligible recipe ids: ${missingIds.join(', ')}.`,
      );
    }

    return byId;
  }

  private normalizeRecipeId(recipeId: string): string {
    const trimmed = recipeId?.trim();
    if (!trimmed) {
      throw new BadRequestException('Recipe id is required.');
    }
    if (!Types.ObjectId.isValid(trimmed)) {
      throw new BadRequestException(`Invalid recipe id: ${trimmed}.`);
    }
    return new Types.ObjectId(trimmed).toString();
  }

  private normalizeOptionalRecipeId(recipeId?: string): string | undefined {
    const trimmed = recipeId?.trim();
    if (!trimmed) return undefined;
    if (!Types.ObjectId.isValid(trimmed)) return trimmed;
    return new Types.ObjectId(trimmed).toString();
  }

  private normalizeOptionalRecipeCode(recipeCode?: string): string | undefined {
    const trimmed = recipeCode?.trim();
    return trimmed ? trimmed : undefined;
  }

  private normalizeOptionalProductionCode(
    productionCode?: string,
  ): string | undefined {
    const trimmed = productionCode?.trim();
    return trimmed ? trimmed : undefined;
  }

  private buildProductionBatchKey(input: {
    productionDate: string;
    productionCode?: string;
    id: string;
  }) {
    const productionCode =
      this.normalizeOptionalProductionCode(input.productionCode) ?? input.id;
    return `${input.productionDate}__${productionCode}`;
  }

  private async ensureNonUniqueProductionCodeIndex() {
    try {
      const indexes = await this.menuProductionModel.collection.indexes();
      const uniqueIndex = indexes.find(
        (index) =>
          Boolean(index.unique) && this.isSingleProductionCodeIndex(index),
      );
      if (uniqueIndex?.name) {
        await this.menuProductionModel.collection.dropIndex(uniqueIndex.name);
      }

      await this.menuProductionModel.collection.createIndex(
        { productionCode: 1 },
        { name: 'productionCode_1', sparse: true },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to ensure non-unique production code index: ${message}`,
      );
    }
  }

  private isSingleProductionCodeIndex(index: {
    key?: Record<string, unknown>;
  }) {
    const entries = Object.entries(index.key ?? {});
    if (entries.length !== 1) return false;
    const [field, direction] = entries[0];
    return field === 'productionCode' && Number(direction) === 1;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeName(value: string) {
    return value ? value.trim().toLowerCase() : '';
  }

  private formatMenuProductionCode(sequence: number): string {
    const safeNumber = Number.isFinite(sequence) && sequence > 0 ? sequence : 1;
    return `${MENU_PRODUCTION_CODE_PREFIX}${String(
      Math.floor(safeNumber),
    ).padStart(MENU_PRODUCTION_CODE_MIN_DIGITS, '0')}`;
  }

  private async reserveMenuProductionCodeRange(count: number): Promise<{
    start: number;
    end: number;
  }> {
    if (!Number.isInteger(count) || count < 1) {
      throw new BadRequestException(
        'Menu production code range count must be >= 1.',
      );
    }

    const counter = await this.menuProductionCodeCounterModel.findOneAndUpdate(
      { key: MENU_PRODUCTION_CODE_COUNTER_KEY },
      {
        $inc: { seq: count },
        $setOnInsert: { key: MENU_PRODUCTION_CODE_COUNTER_KEY },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    if (!counter) {
      throw new BadRequestException(
        'Failed to reserve menu production code range.',
      );
    }

    const end = Number(counter.seq);
    const start = end - count + 1;
    return { start, end };
  }

  private async allocateMenuProductionCodes(count: number): Promise<string[]> {
    if (!count) return [];
    const { start } = await this.reserveMenuProductionCodeRange(count);
    return Array.from({ length: count }, (_, index) =>
      this.formatMenuProductionCode(start + index),
    );
  }

  private async nextMenuProductionCode(): Promise<string> {
    const codes = await this.allocateMenuProductionCodes(1);
    return codes[0];
  }

  private async backfillMissingMenuProductionCodes(): Promise<void> {
    const missingMenus = await this.menuProductionModel
      .find({
        $or: [
          { productionCode: { $exists: false } },
          { productionCode: '' },
          { productionCode: null },
        ],
      })
      .select({ _id: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    if (missingMenus.length === 0) return;

    const codes = await this.allocateMenuProductionCodes(missingMenus.length);
    await this.menuProductionModel.bulkWrite(
      missingMenus.map((item, index) => ({
        updateOne: {
          filter: {
            _id: item._id,
            $or: [
              { productionCode: { $exists: false } },
              { productionCode: '' },
              { productionCode: null },
            ],
          },
          update: { $set: { productionCode: codes[index] } },
        },
      })),
      { ordered: false },
    );
  }

  private normalizeSite(site?: string) {
    const trimmed = site?.trim();
    return trimmed ? trimmed : undefined;
  }

  private buildProductionDateFilter(query: ListMenuProductionsQueryDto) {
    const exactDate = query.productionDate?.trim();
    if (exactDate) return exactDate;

    const startDate = query.startDate?.trim();
    const endDate = query.endDate?.trim();
    if (!startDate && !endDate) return undefined;

    const range: Record<string, string> = {};
    if (startDate) range.$gte = startDate;
    if (endDate) range.$lte = endDate;
    return range;
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
