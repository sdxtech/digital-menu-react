import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CancelPendingMenuProductionBatchDto } from './dto/cancel-pending-menu-production-batch.dto';
import { CancelStoreRequestBatchDto } from './dto/cancel-store-request-batch.dto';
import { CreateMenuProductionDto } from './dto/create-menu-production.dto';
import {
  FulfillStoreRequestBatchDto,
  FulfillStoreRequestBatchItemDto,
} from './dto/fulfill-store-request-batch.dto';
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
import { UsersService } from '../users/users.service';

type StoreRequestIngredient = {
  productCode: string;
  name: string;
  unitOfMeasures: string;
  qty: number;
};

type StoreFulfillmentIngredient = {
  productCode: string;
  name: string;
  unitOfMeasures: string;
  plannedQty: number;
  actualQty: number;
  varianceQty: number;
  reason?: string;
};

type StoreRequestFulfillment = {
  status: 'fulfilled' | 'cancelled';
  completedBy?: string;
  completedAt?: string;
  note?: string;
  items: StoreFulfillmentIngredient[];
};

type StoreRequestMenu = {
  id: string;
  site?: string;
  productionCode?: string;
  submittedByName?: string;
  reviewedBy?: string;
  recipeId?: string;
  recipeCode?: string;
  menuName: string;
  category: string;
  portion: number;
  cost?: number;
  productionDate: string;
  approvalStatus: ApprovalStatus;
  storeRequestStatus: StoreRequestStatus;
  portionSize: number;
  ingredients: StoreRequestIngredient[];
  missingRecipe: boolean;
  fulfilledBy?: string;
  fulfilledAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancellationReason?: string;
};

type StoreRequestGroup = {
  site?: string;
  date: string;
  productionCode?: string;
  items: StoreRequestMenu[];
  summary: StoreRequestIngredient[];
  missingRecipes: string[];
  fulfillment?: StoreRequestFulfillment;
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
    cost?: number;
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

const MENU_PRODUCTION_CODE_PREFIX = 'MPR';
const MENU_PRODUCTION_CODE_MIN_DIGITS = 4;
const MENU_PRODUCTION_CODE_COUNTER_KEY = 'menu_production_code';
const QUANTITY_DECIMAL_PLACES = 6;

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
    private readonly users: UsersService,
  ) {}

  private roundQuantity(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(QUANTITY_DECIMAL_PLACES));
  }

  private resolveMenuSnapshot(
    input: CreateMenuProductionDto,
    recipe: EligibleRecipe,
  ) {
    return {
      menuName: input.menuName?.trim() || recipe.name,
      category: input.category?.trim() || recipe.category,
    };
  }

  async onModuleInit() {
    await this.ensureNonUniqueProductionCodeIndex();
  }

  async create(
    input: CreateMenuProductionDto,
    createdBy?: string,
    site?: string,
    assistedBy?: string,
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

    const normalizedSite = this.requireSite(site);
    const normalizedUnitManagerId = this.normalizeOptionalUserId(
      input.unitManagerId,
      'Unit manager id',
    );
    const menuSnapshot = this.resolveMenuSnapshot(input, recipe);
    return this.menuProductionModel.create({
      productionCode,
      recipeId: recipe.id,
      recipeCode: recipe.recipeCode,
      menuName: menuSnapshot.menuName,
      category: menuSnapshot.category,
      portion: input.portion,
      cost: input.cost,
      productionDate: input.productionDate,
      approvalStatus: 'pending',
      storeRequestStatus: 'not-requested',
      createdBy,
      unitManagerId: normalizedUnitManagerId,
      assistedBy,
      site: normalizedSite,
    });
  }

  async createMany(
    inputs: CreateMenuProductionDto[],
    createdBy?: string,
    site?: string,
    assistedBy?: string,
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

    const normalizedSite = this.requireSite(site);
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
      const menuSnapshot = this.resolveMenuSnapshot(input, recipe);

      return {
        productionCode: productionCodeByDate.get(input.productionDate),
        recipeId: recipe.id,
        recipeCode: recipe.recipeCode,
        menuName: menuSnapshot.menuName,
        category: menuSnapshot.category,
        portion: input.portion,
        cost: input.cost,
        productionDate: input.productionDate,
        approvalStatus: 'pending',
        storeRequestStatus: 'not-requested',
        createdBy,
        unitManagerId: this.normalizeOptionalUserId(
          input.unitManagerId,
          'Unit manager id',
        ),
        assistedBy,
        site: normalizedSite,
      };
    });
    return this.menuProductionModel.insertMany(payload, { ordered: false });
  }

  async findAll(
    query: ListMenuProductionsQueryDto,
    site?: string,
    unitManagerId?: string,
  ) {
    await this.backfillMissingMenuProductionCodes();

    const filter: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];
    const siteFilter = this.buildSiteFilter(site);
    if (Object.keys(siteFilter).length) {
      andFilters.push(siteFilter);
    }
    const unitManagerFilter = this.buildUnitManagerFilter(unitManagerId);
    if (Object.keys(unitManagerFilter).length) {
      andFilters.push(unitManagerFilter);
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
    unitManagerId?: string,
  ) {
    // BACKEND LOGIC: approval drives store-request status automatically.
    const nextStoreStatus: StoreRequestStatus =
      status === 'approved' ? 'requested' : 'not-requested';
    const actor = reviewedBy?.trim();
    const filter = this.withUnitManagerFilter(
      this.withSiteFilter({ _id: id }, site),
      unitManagerId,
    );
    const updated = await this.menuProductionModel
      .findOneAndUpdate(
        filter,
        {
          $set: {
            approvalStatus: status,
            storeRequestStatus: nextStoreStatus,
            ...(actor ? { reviewedBy: actor } : {}),
          },
          $unset: {
            fulfilledBy: 1,
            storeFulfillmentItems: 1,
            storeFulfillmentCompletedAt: 1,
            storeFulfillmentNote: 1,
            storeCancelledBy: 1,
            storeCancelledAt: 1,
            storeCancellationReason: 1,
          },
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
    if (status === 'cancelled') {
      throw new BadRequestException(
        'Cancel store requests through the batch cancellation flow.',
      );
    }
    item.storeRequestStatus = status;
    if (status === 'fulfilled') {
      const actor = fulfilledBy?.trim();
      item.fulfilledBy = actor || 'Unknown user';
      item.storeFulfillmentCompletedAt = new Date();
      item.storeFulfillmentItems = [];
      item.storeFulfillmentNote = undefined;
      item.storeCancelledBy = undefined;
      item.storeCancelledAt = undefined;
      item.storeCancellationReason = undefined;
    } else {
      item.fulfilledBy = undefined;
      item.storeFulfillmentCompletedAt = undefined;
      item.storeFulfillmentItems = [];
      item.storeFulfillmentNote = undefined;
      item.storeCancelledBy = undefined;
      item.storeCancelledAt = undefined;
      item.storeCancellationReason = undefined;
    }
    return item.save();
  }

  async fulfillStoreRequestBatch(
    input: FulfillStoreRequestBatchDto,
    site?: string,
    fulfilledBy?: string,
    options: { allowStatusOverride?: boolean } = {},
  ) {
    const normalizedIds = Array.from(
      new Set(
        (input.menuProductionIds ?? [])
          .map((id) => id?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (normalizedIds.length === 0) {
      throw new BadRequestException('Menu production ids are required.');
    }

    const menus = await this.menuProductionModel
      .find(this.withSiteFilter({ _id: { $in: normalizedIds } }, site))
      .sort({ productionDate: 1, createdAt: -1 })
      .lean();

    if (menus.length !== normalizedIds.length) {
      throw new NotFoundException(
        'One or more menu productions were not found.',
      );
    }

    if (!options.allowStatusOverride) {
      menus.forEach((menu) => {
        if (menu.approvalStatus !== 'approved') {
          throw new BadRequestException('Menu production is not approved yet.');
        }
        if (menu.storeRequestStatus !== 'requested') {
          throw new BadRequestException(
            'Store request has not been submitted yet or is already processed.',
          );
        }
      });
    }

    const batchKeys = Array.from(
      new Set(
        menus.map((menu) =>
          this.buildProductionBatchKey({
            productionDate: menu.productionDate,
            productionCode: menu.productionCode,
            site: menu.site,
            id: String(menu._id ?? menu.id ?? ''),
          }),
        ),
      ),
    );
    if (batchKeys.length !== 1) {
      throw new BadRequestException(
        'All menu productions in a fulfill request must belong to the same batch.',
      );
    }

    const grouped = await this.buildGroupedStoreRequestsFromMenus(
      menus,
      this.normalizeSite(site),
    );
    const batch = grouped[0];
    if (!batch || batch.summary.length === 0) {
      throw new BadRequestException(
        'Selected batch has no planned raw materials to fulfill.',
      );
    }

    const actualItems = new Map<string, FulfillStoreRequestBatchItemDto>();
    input.items.forEach((item) => {
      const key = this.buildStoreIngredientKey(
        item.productCode,
        item.name,
        item.unitOfMeasures,
      );
      if (!key) {
        throw new BadRequestException(
          'Each fulfillment item must be identifiable.',
        );
      }
      if (actualItems.has(key)) {
        throw new BadRequestException(
          `Duplicate fulfillment item submitted for ${item.productCode}.`,
        );
      }
      actualItems.set(key, item);
    });

    const fulfillmentItems: StoreFulfillmentIngredient[] = batch.summary.map(
      (plannedItem) => {
        const key = this.buildStoreIngredientKey(
          plannedItem.productCode,
          plannedItem.name,
          plannedItem.unitOfMeasures,
        );
        const actualItem = key ? actualItems.get(key) : undefined;
        if (!actualItem) {
          throw new BadRequestException(
            `Missing actual quantity for ${plannedItem.productCode || plannedItem.name}.`,
          );
        }

        const plannedQty = this.roundQuantity(Number(plannedItem.qty));
        const actualQty = this.roundQuantity(Number(actualItem.actualQty));
        const varianceQty = this.roundQuantity(actualQty - plannedQty);
        const normalizedReason = actualItem.reason?.trim();
        if (varianceQty !== 0 && !normalizedReason) {
          throw new BadRequestException(
            `Variance reason is required for ${plannedItem.productCode || plannedItem.name}.`,
          );
        }

        actualItems.delete(key);
        return {
          productCode: plannedItem.productCode,
          name: plannedItem.name,
          unitOfMeasures: plannedItem.unitOfMeasures,
          plannedQty,
          actualQty,
          varianceQty,
          reason: normalizedReason || undefined,
        };
      },
    );

    actualItems.forEach((actualItem) => {
      const actualQty = this.roundQuantity(Number(actualItem.actualQty));
      const normalizedReason = actualItem.reason?.trim();
      if (!Number.isFinite(actualQty) || actualQty <= 0) {
        throw new BadRequestException(
          `Actual qty for added ingredient ${actualItem.productCode || actualItem.name} must be greater than 0.`,
        );
      }
      if (!normalizedReason) {
        throw new BadRequestException(
          `Reason is required for added ingredient ${actualItem.productCode || actualItem.name}.`,
        );
      }

      fulfillmentItems.push({
        productCode: actualItem.productCode,
        name: actualItem.name,
        unitOfMeasures: actualItem.unitOfMeasures,
        plannedQty: 0,
        actualQty,
        varianceQty: actualQty,
        reason: normalizedReason,
      });
    });

    const actor = fulfilledBy?.trim() || 'Unknown user';
    const completedAt = new Date();
    const note = input.note?.trim();

    const updateFilter: Record<string, unknown> = {
      _id: { $in: normalizedIds },
    };
    if (!options.allowStatusOverride) {
      updateFilter.approvalStatus = 'approved';
      updateFilter.storeRequestStatus = 'requested';
    }

    const updateResult = await this.menuProductionModel.updateMany(
      this.withSiteFilter(updateFilter, site),
      {
        $set: {
          storeRequestStatus: 'fulfilled',
          fulfilledBy: actor,
          storeFulfillmentItems: fulfillmentItems,
          storeFulfillmentCompletedAt: completedAt,
          ...(note ? { storeFulfillmentNote: note } : {}),
        },
        $unset: {
          ...(note ? {} : { storeFulfillmentNote: 1 }),
          storeCancelledBy: 1,
          storeCancelledAt: 1,
          storeCancellationReason: 1,
        },
      },
    );
    const completedCount = options.allowStatusOverride
      ? updateResult.matchedCount
      : updateResult.modifiedCount;
    if (completedCount !== normalizedIds.length) {
      throw new BadRequestException(
        'Store request was already completed or cancelled by another user. Please refresh the list.',
      );
    }

    return {
      productionDate: batch.date,
      productionCode: batch.productionCode,
      fulfilledCount: normalizedIds.length,
      fulfilledBy: actor,
      completedAt: completedAt.toISOString(),
    };
  }

  async cancelStoreRequestBatch(
    input: CancelStoreRequestBatchDto,
    site?: string,
    cancelledBy?: string,
    options: { allowStatusOverride?: boolean } = {},
  ) {
    const normalizedIds = Array.from(
      new Set(
        (input.menuProductionIds ?? [])
          .map((id) => id?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (normalizedIds.length === 0) {
      throw new BadRequestException('Menu production ids are required.');
    }

    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Cancellation reason is required.');
    }

    const menus = await this.menuProductionModel
      .find(this.withSiteFilter({ _id: { $in: normalizedIds } }, site))
      .sort({ productionDate: 1, createdAt: -1 })
      .lean();

    if (menus.length !== normalizedIds.length) {
      throw new NotFoundException(
        'One or more menu productions were not found.',
      );
    }

    if (!options.allowStatusOverride) {
      menus.forEach((menu) => {
        if (menu.approvalStatus !== 'approved') {
          throw new BadRequestException('Menu production is not approved yet.');
        }
        if (menu.storeRequestStatus !== 'requested') {
          throw new BadRequestException(
            'Store request has not been submitted yet or is already processed.',
          );
        }
      });
    }

    const batchKeys = Array.from(
      new Set(
        menus.map((menu) =>
          this.buildProductionBatchKey({
            productionDate: menu.productionDate,
            productionCode: menu.productionCode,
            site: menu.site,
            id: String(menu._id ?? menu.id ?? ''),
          }),
        ),
      ),
    );
    if (batchKeys.length !== 1) {
      throw new BadRequestException(
        'All menu productions in a cancellation request must belong to the same batch.',
      );
    }

    const actor = cancelledBy?.trim() || 'Unknown user';
    const cancelledAt = new Date();

    await this.menuProductionModel.updateMany(
      this.withSiteFilter({ _id: { $in: normalizedIds } }, site),
      {
        $set: {
          storeRequestStatus: 'cancelled',
          storeCancelledBy: actor,
          storeCancelledAt: cancelledAt,
          storeCancellationReason: reason,
        },
        $unset: {
          fulfilledBy: 1,
          storeFulfillmentItems: 1,
          storeFulfillmentCompletedAt: 1,
          storeFulfillmentNote: 1,
        },
      },
    );

    const firstMenu = menus[0];
    return {
      productionDate: firstMenu?.productionDate,
      productionCode: this.normalizeOptionalProductionCode(
        firstMenu?.productionCode,
      ),
      cancelledCount: normalizedIds.length,
      cancelledBy: actor,
      cancelledAt: cancelledAt.toISOString(),
      reason,
    };
  }

  async cancelPendingMenuProductionBatch(
    input: CancelPendingMenuProductionBatchDto,
    site?: string,
  ) {
    const normalizedIds = Array.from(
      new Set(
        (input.menuProductionIds ?? [])
          .map((id) => id?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (normalizedIds.length === 0) {
      throw new BadRequestException('Menu production ids are required.');
    }

    const menus = await this.menuProductionModel
      .find(this.withSiteFilter({ _id: { $in: normalizedIds } }, site))
      .sort({ productionDate: -1, createdAt: -1 })
      .lean();

    if (menus.length !== normalizedIds.length) {
      throw new NotFoundException(
        'One or more menu productions were not found.',
      );
    }

    menus.forEach((menu) => {
      if (menu.approvalStatus !== 'pending') {
        throw new BadRequestException(
          'Only pending menu productions can be cancelled by Chef.',
        );
      }
    });

    const batchKeys = Array.from(
      new Set(
        menus.map((menu) =>
          this.buildProductionBatchKey({
            productionDate: menu.productionDate,
            productionCode: menu.productionCode,
            site: menu.site,
            id: String(menu._id ?? menu.id ?? ''),
          }),
        ),
      ),
    );
    if (batchKeys.length !== 1) {
      throw new BadRequestException(
        'All cancelled menu productions must belong to the same batch.',
      );
    }

    await this.menuProductionModel.deleteMany(
      this.withSiteFilter({ _id: { $in: normalizedIds } }, site),
    );

    const firstMenu = menus[0];
    return {
      productionDate: firstMenu?.productionDate,
      productionCode: this.normalizeOptionalProductionCode(
        firstMenu?.productionCode,
      ),
      cancelledCount: normalizedIds.length,
    };
  }

  // BACKEND LOGIC: production timeline grouping + approval stats.
  async buildTimeline(
    query: ListMenuProductionsQueryDto,
    site?: string,
    unitManagerId?: string,
  ) {
    await this.backfillMissingMenuProductionCodes();

    const filter: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];
    const siteFilter = this.buildSiteFilter(site);
    if (Object.keys(siteFilter).length) {
      andFilters.push(siteFilter);
    }
    const unitManagerFilter = this.buildUnitManagerFilter(unitManagerId);
    if (Object.keys(unitManagerFilter).length) {
      andFilters.push(unitManagerFilter);
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
      .sort({ productionDate: -1, createdAt: -1 })
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
        site: item.site,
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
        cost: Number.isFinite(Number(item.cost))
          ? Number(item.cost)
          : undefined,
        approvalStatus: item.approvalStatus,
        reviewedBy: item.reviewedBy,
      });
      grouped.set(groupKey, bucket);
    });

    const groups = Array.from(grouped.values()).sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;
      return (b.productionCode ?? '').localeCompare(a.productionCode ?? '');
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
    unitManagerId?: string,
  ) {
    await this.backfillMissingMenuProductionCodes();
    const requestedSite = this.normalizeSite(site);

    const filter: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];
    const siteFilter = this.buildSiteFilter(site);
    if (Object.keys(siteFilter).length) {
      andFilters.push(siteFilter);
    }
    const unitManagerFilter = this.buildUnitManagerFilter(unitManagerId);
    if (Object.keys(unitManagerFilter).length) {
      andFilters.push(unitManagerFilter);
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

    const grouped = await this.buildGroupedStoreRequestsFromMenus(
      items,
      requestedSite,
    );

    return { items: grouped };
  }

  async listStoreRequestSites() {
    const rawSites = await this.menuProductionModel.distinct('site', {
      approvalStatus: 'approved',
    });

    const normalized = rawSites
      .map((site) => String(site).trim())
      .filter(Boolean);

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

  private normalizeOptionalUserId(
    userId?: string,
    fieldName = 'User id',
  ): string | undefined {
    const trimmed = userId?.trim();
    if (!trimmed) return undefined;
    if (!Types.ObjectId.isValid(trimmed)) {
      throw new BadRequestException(`${fieldName} is invalid.`);
    }
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
    site?: string;
    id: string;
  }) {
    const productionCode =
      this.normalizeOptionalProductionCode(input.productionCode) ?? input.id;
    const site = this.normalizeSite(input.site) ?? '';
    return `${site}__${input.productionDate}__${productionCode}`;
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

  private buildStoreIngredientKey(
    productCode?: string,
    name?: string,
    unitOfMeasures?: string,
  ) {
    const identity = this.normalizeName(productCode || name || '');
    const unit = this.normalizeName(unitOfMeasures || '');
    if (!identity || !unit) return '';
    return `${identity}__${unit}`;
  }

  private mapStoreFulfillmentItems(
    items: unknown,
  ): StoreFulfillmentIngredient[] {
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
      const record =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {};
      return {
        productCode: String(record.productCode ?? '').trim(),
        name: String(record.name ?? '').trim(),
        unitOfMeasures: String(record.unitOfMeasures ?? '').trim(),
        plannedQty: Number(record.plannedQty ?? 0),
        actualQty: Number(record.actualQty ?? 0),
        varianceQty: Number(record.varianceQty ?? 0),
        reason: String(record.reason ?? '').trim() || undefined,
      };
    });
  }

  private async buildGroupedStoreRequestsFromMenus(
    items: Array<
      Partial<MenuProduction> & {
        _id?: unknown;
        id?: unknown;
        createdBy?: unknown;
        storeFulfillmentItems?: unknown;
        storeFulfillmentCompletedAt?: unknown;
        storeFulfillmentNote?: unknown;
        storeCancelledAt?: unknown;
        storeCancelledBy?: unknown;
        storeCancellationReason?: unknown;
      }
    >,
    requestedSite?: string,
  ) {
    if (items.length === 0) {
      return [] as StoreRequestGroup[];
    }

    const creatorIds = Array.from(
      new Set(
        items
          .map((item) => String(item.createdBy ?? '').trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const creatorNameById =
      creatorIds.length > 0
        ? await this.users.findNamesByIds(creatorIds)
        : new Map<string, string>();

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
        fulfillment?: StoreRequestFulfillment;
      }
    >();

    items.forEach((menu) => {
      const productionDate = String(menu.productionDate ?? '').trim();
      const groupKey = this.buildProductionBatchKey({
        productionDate,
        productionCode: String(menu.productionCode ?? ''),
        site: String(menu.site ?? '') || requestedSite,
        id: String(menu._id ?? menu.id ?? ''),
      });
      const group = groups.get(groupKey) ?? {
        site: this.normalizeSite(String(menu.site ?? '')) ?? requestedSite,
        date: productionDate,
        productionCode: this.normalizeOptionalProductionCode(
          String(menu.productionCode ?? ''),
        ),
        items: [],
        summaryMap: new Map<string, StoreRequestIngredient>(),
        missingRecipes: new Set<string>(),
      };

      const menuRecipeId = this.normalizeOptionalRecipeId(
        String(menu.recipeId ?? ''),
      );
      const recipe =
        (menuRecipeId ? recipeById.get(menuRecipeId) : undefined) ??
        recipeByName.get(this.normalizeName(String(menu.menuName ?? '')));
      let ingredients: StoreRequestIngredient[] = [];
      let missingRecipe = false;
      let portionSize = 1;
      const submittedById = String(menu.createdBy ?? '').trim();
      const submittedByName = submittedById
        ? creatorNameById.get(submittedById)
        : undefined;
      const resolvedRecipeId =
        menuRecipeId ??
        (recipe
          ? this.normalizeOptionalRecipeId(String(recipe._id ?? ''))
          : undefined);
      const resolvedRecipeCode =
        this.normalizeOptionalRecipeCode(String(menu.recipeCode ?? '')) ??
        this.normalizeOptionalRecipeCode(recipe?.recipeCode);

      if (!recipe) {
        missingRecipe = true;
        if (menu.menuName) {
          group.missingRecipes.add(String(menu.menuName));
        }
      } else {
        portionSize = Number(recipe.portionSize) || 1;
        if (portionSize <= 0) portionSize = 1;
        const multiplier = Number(menu.portion) / portionSize;

        ingredients = (recipe.ingredients ?? []).map((ingredient) => {
          const productCode = ingredient.productCode?.trim() ?? '';
          const name = ingredient.name?.trim() ?? '';
          const unitOfMeasures = ingredient.unitOfMeasures?.trim() ?? '';
          const baseQty = Number(ingredient.qty);
          const qty = (Number.isFinite(baseQty) ? baseQty : 0) * multiplier;
          const normalizedKey = this.buildStoreIngredientKey(
            productCode,
            name,
            unitOfMeasures,
          );
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

      const fulfilledAtValue = menu.storeFulfillmentCompletedAt;
      const fulfilledAt =
        fulfilledAtValue instanceof Date
          ? fulfilledAtValue.toISOString()
          : fulfilledAtValue
            ? new Date(String(fulfilledAtValue)).toISOString()
            : undefined;
      const fulfillmentItems = this.mapStoreFulfillmentItems(
        menu.storeFulfillmentItems,
      );
      const fulfillmentNote =
        String(menu.storeFulfillmentNote ?? '').trim() || undefined;
      const fulfilledBy = String(menu.fulfilledBy ?? '').trim() || undefined;
      const cancelledAtValue = menu.storeCancelledAt;
      const cancelledAt =
        cancelledAtValue instanceof Date
          ? cancelledAtValue.toISOString()
          : cancelledAtValue
            ? new Date(String(cancelledAtValue)).toISOString()
            : undefined;
      const cancelledBy =
        String(menu.storeCancelledBy ?? '').trim() || undefined;
      const cancellationReason =
        String(menu.storeCancellationReason ?? '').trim() || undefined;
      const reviewedBy = String(menu.reviewedBy ?? '').trim() || undefined;

      if (
        !group.fulfillment &&
        (menu.storeRequestStatus === 'cancelled'
          ? cancelledAt || cancellationReason || cancelledBy
          : fulfillmentItems.length > 0 ||
            fulfilledAt ||
            fulfillmentNote ||
            fulfilledBy)
      ) {
        group.fulfillment = {
          status:
            menu.storeRequestStatus === 'cancelled' ? 'cancelled' : 'fulfilled',
          completedBy:
            menu.storeRequestStatus === 'cancelled' ? cancelledBy : fulfilledBy,
          completedAt:
            menu.storeRequestStatus === 'cancelled' ? cancelledAt : fulfilledAt,
          note:
            menu.storeRequestStatus === 'cancelled'
              ? cancellationReason
              : fulfillmentNote,
          items:
            menu.storeRequestStatus === 'cancelled' ? [] : fulfillmentItems,
        };
      }

      group.items.push({
        id: String(menu._id ?? menu.id ?? ''),
        site: this.normalizeSite(String(menu.site ?? '')) ?? group.site,
        productionCode: this.normalizeOptionalProductionCode(
          String(menu.productionCode ?? ''),
        ),
        submittedByName,
        reviewedBy,
        recipeId: resolvedRecipeId,
        recipeCode: resolvedRecipeCode,
        menuName: String(menu.menuName ?? ''),
        category: String(menu.category ?? ''),
        portion: Number(menu.portion ?? 0),
        cost: Number.isFinite(Number(menu.cost))
          ? Number(menu.cost)
          : undefined,
        productionDate,
        approvalStatus: menu.approvalStatus ?? 'pending',
        storeRequestStatus: menu.storeRequestStatus ?? 'not-requested',
        portionSize,
        ingredients,
        missingRecipe,
        fulfilledBy,
        fulfilledAt,
        cancelledBy,
        cancelledAt,
        cancellationReason,
      });

      groups.set(groupKey, group);
    });

    return Array.from(groups.values())
      .map((group) => ({
        site: group.site,
        date: group.date,
        productionCode: group.productionCode,
        items: group.items,
        summary: Array.from(group.summaryMap.values()),
        missingRecipes: Array.from(group.missingRecipes.values()),
        fulfillment: group.fulfillment,
      }))
      .sort((a, b) => {
        const byDate = a.date.localeCompare(b.date);
        if (byDate !== 0) return byDate;
        return (a.productionCode ?? '').localeCompare(b.productionCode ?? '');
      });
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

  private requireSite(site?: string) {
    const normalizedSite = this.normalizeSite(site);
    if (!normalizedSite) {
      throw new BadRequestException('Menu production requires a site.');
    }
    return normalizedSite;
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
    return { site };
  }

  private buildUnitManagerFilter(unitManagerId?: string) {
    const normalizedUnitManagerId = this.normalizeOptionalUserId(unitManagerId);
    if (!normalizedUnitManagerId) return {};
    return {
      $or: [
        { unitManagerId: normalizedUnitManagerId },
        { unitManagerId: { $exists: false } },
        { unitManagerId: '' },
        { unitManagerId: null },
      ],
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

  private withUnitManagerFilter(
    filter: Record<string, unknown>,
    unitManagerId?: string,
  ) {
    const unitManagerFilter = this.buildUnitManagerFilter(unitManagerId);
    if (!Object.keys(unitManagerFilter).length) return filter;
    return { $and: [filter, unitManagerFilter] };
  }
}
