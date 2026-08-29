import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { CancelPendingMenuProductionBatchDto } from './dto/cancel-pending-menu-production-batch.dto';
import { CancelStoreRequestBatchDto } from './dto/cancel-store-request-batch.dto';
import { ChangeRejectedMenuProductionDto } from './dto/change-rejected-menu-production.dto';
import { CreateMenuProductionDto } from './dto/create-menu-production.dto';
import { UpdateMenuProductionSalesDetailsDto } from './dto/update-menu-production-sales-details.dto';
import { UpdateMenuProductionBatchSalesDetailsDto } from './dto/update-menu-production-batch-sales-details.dto';
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
  MenuProductionIngredientVendor,
  StoreRequestStatus,
} from './schemas/menu-production.schema';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkflowMailService } from '../mail/workflow-mail.service';

type StoreRequestIngredient = {
  ingredientType?: 'IT' | 'NMP';
  productCode: string;
  name: string;
  unitOfMeasures: string;
  qty: number;
  vendor?: string;
  vendorSite?: string;
  price?: number;
  ingredientCost?: number;
  plannedIngredientCost?: number;
};

type StoreFulfillmentIngredient = {
  productCode: string;
  name: string;
  unitOfMeasures: string;
  plannedQty: number;
  actualQty: number;
  varianceQty: number;
  vendor?: string;
  vendorSite?: string;
  price?: number;
  ingredientCost?: number;
  plannedIngredientCost?: number;
  actualIngredientCost?: number;
  plannedPrice?: number;
  actualPrice?: number;
  variancePrice?: number;
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
  submittedAt?: string;
  approvedAt?: string;
  recipeId?: string;
  recipeCode?: string;
  recipeVersion?: number;
  menuName: string;
  clientName?: string;
  category: string;
  group?: string;
  portion: number;
  cost?: number;
  estimatedCost?: number;
  estimatedCostPerPax?: number;
  sellingPricePerPax?: number;
  sellingQuantity?: number;
  estimatedRevenue?: number;
  salesInputBy?: string;
  productionDate: string;
  approvalStatus: ApprovalStatus;
  rejectionReason?: string;
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
    recipeVersion?: number;
    menuName: string;
    clientName?: string;
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
  version: number;
  name: string;
  category: string;
  portionSize?: number;
  ingredients?: Array<{
    productCode?: string;
    name?: string;
    unitOfMeasures?: string;
    qty?: number;
    priceUom?: number;
    foodCost?: number;
  }>;
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
    private readonly notificationsService: NotificationsService, // 🌟 ADDED SAFELY HERE
    private readonly workflowMail: WorkflowMailService,
  ) {}

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  private toMailRecord(record: {
    _id?: unknown;
    id?: unknown;
    productionCode?: unknown;
    menuName?: unknown;
    productionDate?: unknown;
    site?: unknown;
    createdBy?: unknown;
    unitManagerId?: unknown;
    approvalStatus?: unknown;
  }) {
    return {
      id: this.textValue(record._id ?? record.id),
      productionCode: this.textValue(record.productionCode),
      menuName: this.textValue(record.menuName),
      productionDate: this.textValue(record.productionDate),
      site: this.textValue(record.site),
      createdBy: this.textValue(record.createdBy),
      unitManagerId: this.textValue(record.unitManagerId),
      approvalStatus: record.approvalStatus as
        | 'pending'
        | 'approved'
        | 'rejected'
        | undefined,
    };
  }

  private dispatchMenuProductionSubmissionNotifications(
    records: Array<Parameters<MenuProductionsService['toMailRecord']>[0]>,
    deduplicationContext?: string,
  ) {
    const mailRecords = records.map((record) => this.toMailRecord(record));
    const byProductionCode = new Map<string, (typeof mailRecords)[number]>();
    mailRecords.forEach((record) => {
      if (
        record.productionCode &&
        !byProductionCode.has(record.productionCode)
      ) {
        byProductionCode.set(record.productionCode, record);
      }
    });
    byProductionCode.forEach((record) => {
      this.notificationsService
        .createHierarchicalNotification(
          record.createdBy || 'system',
          'New Menu Production Sales Input',
          `A new production batch (${record.productionCode}) is awaiting selling price and pax calculation input.`,
          record.site || 'global',
          'admin-site',
          'ADMIN_SITE_MENU_PRODUCTION_SALES',
          { productionCode: record.productionCode },
        )
        .catch((error) =>
          this.logger.error(
            `Admin Site sales input notification failed: ${this.errorMessage(error)}`,
          ),
        );
    });
    void this.workflowMail
      .notifyMenuProductionsSubmitted(mailRecords, deduplicationContext)
      .catch((error) =>
        this.logger.error(
          `Menu production submission email failed: ${this.errorMessage(error)}`,
        ),
      );
  }

  private async finalizeMenuProductionBatchReview(record: {
    _id?: unknown;
    id?: unknown;
    productionCode?: string;
    site?: string;
  }) {
    const batchFilter: Record<string, unknown> = record.productionCode
      ? {
          productionCode: record.productionCode,
          ...(record.site ? { site: record.site } : {}),
        }
      : { _id: record._id ?? record.id };
    const reviewedBatch = await this.menuProductionModel
      .find(batchFilter)
      .select({
        productionCode: 1,
        menuName: 1,
        productionDate: 1,
        site: 1,
        createdBy: 1,
        unitManagerId: 1,
        approvalStatus: 1,
      })
      .lean();
    const pendingCount = reviewedBatch.filter(
      (item) => item.approvalStatus === 'pending',
    ).length;
    const rejectedCount = reviewedBatch.filter(
      (item) => item.approvalStatus === 'rejected',
    ).length;
    const approvedCount = reviewedBatch.filter(
      (item) => item.approvalStatus === 'approved',
    ).length;
    const isComplete = reviewedBatch.length > 0 && pendingCount === 0;
    const allApproved =
      isComplete &&
      rejectedCount === 0 &&
      approvedCount === reviewedBatch.length;

    if (isComplete) {
      await this.menuProductionModel.updateMany(batchFilter, {
        $set: {
          storeRequestStatus: allApproved ? 'requested' : 'not-requested',
        },
        ...(!allApproved
          ? {
              $unset: {
                fulfilledBy: 1,
                storeFulfillmentItems: 1,
                storeFulfillmentCompletedAt: 1,
                storeFulfillmentNote: 1,
                storeCancelledBy: 1,
                storeCancelledAt: 1,
                storeCancellationReason: 1,
              },
            }
          : {}),
      });
    }

    return {
      records: reviewedBatch.map((item) => this.toMailRecord(item)),
      isComplete,
      allApproved,
      approvedCount,
      rejectedCount,
    };
  }

  private textValue(value: unknown) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Types.ObjectId) return value.toString();
    if (typeof value === 'object') {
      const text = (value as { toString?: () => string }).toString?.();
      return text && text !== '[object Object]' ? text : '';
    }
    return '';
  }

  private roundQuantity(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(QUANTITY_DECIMAL_PLACES));
  }

  private normalizeRecipeVersion(value: unknown) {
    const version = Number(value);
    return Number.isInteger(version) && version >= 1 ? version : 1;
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

  private calculateMenuProductionCostSnapshot(
    input: CreateMenuProductionDto,
    recipe: EligibleRecipe,
  ) {
    const selectedVendors = this.normalizeIngredientVendors(
      input.ingredientVendors,
    );
    const portionSize =
      Number.isFinite(Number(recipe.portionSize)) &&
      Number(recipe.portionSize) > 0
        ? Number(recipe.portionSize)
        : 1;
    const portion =
      Number.isFinite(Number(input.portion)) && Number(input.portion) > 0
        ? Number(input.portion)
        : 0;
    const multiplier = portionSize > 0 ? portion / portionSize : 0;
    let estimatedTotalCost = 0;
    let hasCost = false;

    const ingredientVendors = (recipe.ingredients ?? []).map(
      (ingredient, ingredientIndex) => {
        const productCode = ingredient.productCode?.trim() ?? '';
        const name = ingredient.name?.trim() ?? '';
        const unitOfMeasures = ingredient.unitOfMeasures?.trim() ?? '';
        const baseQty = Number(ingredient.qty);
        const qty = (Number.isFinite(baseQty) ? baseQty : 0) * multiplier;
        const selectedVendor = this.findIngredientVendor(
          selectedVendors,
          ingredientIndex,
          productCode,
          name,
          unitOfMeasures,
        );
        const vendorPrice = Number(selectedVendor?.price);
        const priceUom = Number(ingredient.priceUom);
        const foodCost = Number(ingredient.foodCost);
        const unitPrice = Number.isFinite(vendorPrice)
          ? vendorPrice
          : Number.isFinite(priceUom)
            ? priceUom
            : Number.isFinite(foodCost) &&
                Number.isFinite(baseQty) &&
                baseQty > 0
              ? foodCost / baseQty
              : undefined;
        const ingredientCost =
          unitPrice !== undefined
            ? this.roundQuantity(qty * unitPrice)
            : undefined;

        if (ingredientCost !== undefined) {
          estimatedTotalCost += ingredientCost;
          hasCost = true;
        }

        return {
          ingredientIndex,
          productCode,
          name,
          unitOfMeasures,
          vendor: selectedVendor?.vendor,
          site: selectedVendor?.site,
          currency: selectedVendor?.currency,
          minimumQuantity: selectedVendor?.minimumQuantity,
          price: unitPrice,
          ingredientCost,
        };
      },
    );

    const estimatedTotal = hasCost
      ? this.roundQuantity(estimatedTotalCost)
      : undefined;
    const estimatedPerPax =
      estimatedTotal !== undefined && portion > 0
        ? this.roundQuantity(estimatedTotal / portion)
        : undefined;

    return {
      ingredientVendors: this.normalizeIngredientVendors(ingredientVendors),
      estimatedTotalCost: estimatedTotal,
      estimatedCostPerPax: estimatedPerPax,
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
    const costSnapshot = this.calculateMenuProductionCostSnapshot(
      input,
      recipe,
    );
    const isDraft = input.saveAsDraft === true;
    const created = await this.menuProductionModel.create({
      productionCode,
      recipeId: recipe.id,
      recipeCode: recipe.recipeCode,
      recipeVersion: recipe.version,
      menuName: menuSnapshot.menuName,
      category: menuSnapshot.category,
      group: input.group?.trim() || undefined,
      clientId: input.clientId?.trim(),
      clientName: input.clientName?.trim(),
      portion: input.portion,
      cost: costSnapshot.estimatedTotalCost ?? input.cost,
      estimatedTotalCost: costSnapshot.estimatedTotalCost,
      estimatedCostPerPax: costSnapshot.estimatedCostPerPax,
      ingredientVendors: costSnapshot.ingredientVendors,
      productionDate: input.productionDate,
      approvalStatus: 'pending',
      isDraft,
      ...(isDraft ? {} : { submittedAt: new Date() }),
      storeRequestStatus: 'not-requested',
      createdBy,
      unitManagerId: normalizedUnitManagerId,
      assistedBy,
      site: normalizedSite,
    });
    if (!created.isDraft) {
      this.dispatchMenuProductionSubmissionNotifications([created]);
    }
    return created;
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
    const draftValues = new Set(
      normalizedInputs.map((input) => input.saveAsDraft === true),
    );
    if (draftValues.size > 1) {
      throw new BadRequestException(
        'Bulk menu production cannot mix draft and submitted menus.',
      );
    }
    const saveAsDraft = normalizedInputs[0]?.saveAsDraft === true;
    const submittedAt = saveAsDraft ? undefined : new Date();
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
      const costSnapshot = this.calculateMenuProductionCostSnapshot(
        input,
        recipe,
      );

      return {
        productionCode: productionCodeByDate.get(input.productionDate),
        recipeId: recipe.id,
        recipeCode: recipe.recipeCode,
        recipeVersion: recipe.version,
        menuName: menuSnapshot.menuName,
        category: menuSnapshot.category,
        group: input.group?.trim() || undefined,
        clientId: input.clientId?.trim(),
        clientName: input.clientName?.trim(),
        portion: input.portion,
        cost: costSnapshot.estimatedTotalCost ?? input.cost,
        estimatedTotalCost: costSnapshot.estimatedTotalCost,
        estimatedCostPerPax: costSnapshot.estimatedCostPerPax,
        ingredientVendors: costSnapshot.ingredientVendors,
        productionDate: input.productionDate,
        approvalStatus: 'pending',
        isDraft: saveAsDraft,
        ...(submittedAt ? { submittedAt } : {}),
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

    // 🚀 Write the records to the database first
    const createdDocs = await this.menuProductionModel.insertMany(payload, {
      ordered: false,
    });

    if (createdDocs.length > 0 && !saveAsDraft) {
      this.dispatchMenuProductionSubmissionNotifications(createdDocs);
    }

    return createdDocs;
  }

  async findDrafts(createdBy?: string, site?: string) {
    const chefId = createdBy?.trim();
    if (!chefId) {
      throw new BadRequestException(
        'Chef identity is required to load menu production drafts.',
      );
    }

    const items = await this.menuProductionModel
      .find(this.withSiteFilter({ createdBy: chefId, isDraft: true }, site))
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    return { items, total: items.length };
  }

  async replaceDraft(
    productionCode: string,
    inputs: CreateMenuProductionDto[],
    createdBy?: string,
    site?: string,
    assistedBy?: string,
  ) {
    const normalizedCode = productionCode?.trim();
    const chefId = createdBy?.trim();
    if (!normalizedCode || !chefId) {
      throw new BadRequestException('Menu production draft is invalid.');
    }

    const draftFilter = this.withSiteFilter(
      { productionCode: normalizedCode, createdBy: chefId, isDraft: true },
      site,
    );
    const existingDraft = await this.menuProductionModel.exists(draftFilter);
    if (!existingDraft) {
      throw new NotFoundException('Menu production draft not found.');
    }

    const created = await this.createMany(
      inputs.map((input) => ({ ...input, saveAsDraft: true })),
      chefId,
      site,
      assistedBy,
    );
    await this.menuProductionModel.deleteMany(draftFilter);
    return created;
  }

  async submitDraftBatch(
    productionCode: string,
    createdBy?: string,
    site?: string,
  ) {
    const normalizedCode = productionCode?.trim();
    const chefId = createdBy?.trim();
    if (!normalizedCode || !chefId) {
      throw new BadRequestException('Menu production draft is invalid.');
    }

    const draftFilter = this.withSiteFilter(
      { productionCode: normalizedCode, createdBy: chefId, isDraft: true },
      site,
    );
    const result = await this.menuProductionModel.updateMany(draftFilter, {
      $set: { isDraft: false, submittedAt: new Date() },
    });
    if (!result.matchedCount) {
      throw new NotFoundException('Menu production draft not found.');
    }

    const submitted = await this.menuProductionModel
      .find(
        this.withSiteFilter(
          { productionCode: normalizedCode, createdBy: chefId, isDraft: false },
          site,
        ),
      )
      .lean();
    if (submitted.length > 0) {
      this.dispatchMenuProductionSubmissionNotifications(submitted);
    }
    return submitted;
  }

  async findAll(
    query: ListMenuProductionsQueryDto,
    site?: string,
    unitManagerId?: string,
  ) {
    await this.backfillMissingMenuProductionCodes();

    const filter: Record<string, unknown> = { isDraft: { $ne: true } };
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
    rejectionReason?: string,
  ) {
    if (status === 'approved') {
      const salesDetails = await this.menuProductionModel
        .findOne(
          this.withUnitManagerFilter(
            this.withSiteFilter({ _id: id }, site),
            unitManagerId,
          ),
        )
        .select({ sellingPricePerPax: 1, sellingQuantity: 1 })
        .lean();
      if (
        !salesDetails ||
        !Number.isFinite(Number(salesDetails.sellingPricePerPax)) ||
        !Number.isFinite(Number(salesDetails.sellingQuantity))
      ) {
        throw new BadRequestException(
          'Selling price per pax and selling quantity must be completed by Admin Site before approval.',
        );
      }
    }
    const actor = reviewedBy?.trim();
    const reason = rejectionReason?.trim();
    if (status === 'rejected' && !reason) {
      throw new BadRequestException('Rejection reason is required.');
    }
    const filter = this.withUnitManagerFilter(
      this.withSiteFilter({ _id: id, isDraft: { $ne: true } }, site),
      unitManagerId,
    );
    const updated = await this.menuProductionModel
      .findOneAndUpdate(
        filter,
        {
          $set: {
            approvalStatus: status,
            storeRequestStatus: 'not-requested',
            ...(actor ? { reviewedBy: actor } : {}),
            ...(status === 'approved' ? { approvedAt: new Date() } : {}),
            ...(status === 'rejected' ? { rejectionReason: reason } : {}),
          },
          $unset: {
            ...(status === 'approved' ? { rejectionReason: 1 } : {}),
            ...(status !== 'approved' ? { approvedAt: 1 } : {}),
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

    const batchReview = await this.finalizeMenuProductionBatchReview(updated);
    if (batchReview.isComplete) {
      updated.storeRequestStatus = batchReview.allApproved
        ? 'requested'
        : 'not-requested';
    }

    if (batchReview.isComplete && batchReview.allApproved) {
      this.notificationsService
        .createHierarchicalNotification(
          updated.createdBy || 'system',
          'New Store Request Dispatched',
          `All ${batchReview.approvedCount} menus in production batch ${updated.productionCode} have been approved. Materials aggregation is ready for distribution fulfillment.`,
          updated.site || 'global',
          'storekeeper',
          'STORE_REQUEST_STOREKEEPER',
          { productionCode: updated.productionCode },
        )
        .catch((err) =>
          this.logger.error(
            `Storekeeper notification failed: ${this.errorMessage(err)}`,
          ),
        );

      this.notificationsService
        .createHierarchicalNotification(
          'system',
          'Menu Production Approved',
          `All menus in production batch ${updated.productionCode} have been approved by the Unit Manager and forwarded to Storekeeper.`,
          updated.site || 'global',
          'chef',
          'STORE_REQUEST_RECORDS',
          { productionCode: updated.productionCode },
        )
        .catch((err) =>
          this.logger.error(
            `Chef notification failed: ${this.errorMessage(err)}`,
          ),
        );
    } else if (batchReview.isComplete) {
      this.notificationsService
        .createHierarchicalNotification(
          'system',
          'Menu Production Returned',
          `Production batch ${updated.productionCode} was returned to Chef because ${batchReview.rejectedCount} menu(s) were rejected. It was not forwarded to Storekeeper.`,
          updated.site || 'global',
          'chef',
          'STORE_REQUEST_RECORDS',
          { productionCode: updated.productionCode },
        )
        .catch((err) =>
          this.logger.error(
            `Chef returned-batch notification failed: ${this.errorMessage(err)}`,
          ),
        );
    }

    if (batchReview.isComplete) {
      this.notificationsService
        .markRoleNotificationsAsRead({
          siteCode: updated.site || 'global',
          targetUserRole: 'unit.manager',
          componentKey: 'MENU_PRODUCTION_APPROVAL_REQUESTS',
        })
        .catch((err) =>
          this.logger.error(
            `Failed to clear manager badges: ${this.errorMessage(err)}`,
          ),
        );

      void this.workflowMail
        .notifyMenuProductionBatchReviewed(batchReview.records)
        .catch((error) =>
          this.logger.error(
            `Menu production decision email failed: ${this.errorMessage(error)}`,
          ),
        );
    }

    return updated;
  }

  async changeRejectedMenu(
    id: string,
    input: ChangeRejectedMenuProductionDto,
    chefId?: string,
    site?: string,
  ) {
    const normalizedChefId = chefId?.trim();
    if (!normalizedChefId) {
      throw new BadRequestException('Chef identity is required.');
    }
    const normalizedRecipeId = this.normalizeRecipeId(input.recipeId);
    const normalizedGroup = input.group?.trim();
    if (!normalizedGroup) {
      throw new BadRequestException('Group By is required.');
    }
    const portion = Number(input.portion);
    if (!Number.isInteger(portion) || portion < 1) {
      throw new BadRequestException('Portion must be a positive integer.');
    }
    const filter = this.withSiteFilter(
      {
        _id: id,
        createdBy: normalizedChefId,
        approvalStatus: 'rejected',
        isDraft: { $ne: true },
      },
      site,
    );
    const existing = await this.menuProductionModel.findOne(filter).lean();
    if (!existing) {
      throw new NotFoundException('Rejected menu production not found.');
    }
    if (
      this.normalizeOptionalRecipeId(existing.recipeId) === normalizedRecipeId
    ) {
      throw new BadRequestException(
        'Select a different approved menu for the replacement.',
      );
    }

    const recipeById = await this.findEligibleRecipesById([normalizedRecipeId]);
    const recipe = recipeById.get(normalizedRecipeId);
    if (!recipe) {
      throw new BadRequestException('Replacement menu is not eligible.');
    }
    const selectedVendors = this.normalizeIngredientVendors(
      input.ingredientVendors,
    );
    for (const [ingredientIndex, ingredient] of (
      recipe.ingredients ?? []
    ).entries()) {
      const selectedVendor = this.findIngredientVendor(
        selectedVendors,
        ingredientIndex,
        ingredient.productCode?.trim() ?? '',
        ingredient.name?.trim() ?? '',
        ingredient.unitOfMeasures?.trim() ?? '',
      );
      if (!selectedVendor?.vendor?.trim()) {
        throw new BadRequestException(
          `Vendor is required for ingredient ${ingredient.name || ingredient.productCode || ingredientIndex + 1}.`,
        );
      }
      if (
        !Number.isFinite(Number(selectedVendor.price)) ||
        Number(selectedVendor.price) < 0
      ) {
        throw new BadRequestException(
          `Price is required for ingredient ${ingredient.name || ingredient.productCode || ingredientIndex + 1}.`,
        );
      }
    }
    const replacementInput: CreateMenuProductionDto = {
      recipeId: normalizedRecipeId,
      portion,
      cost: 0,
      ingredientVendors: input.ingredientVendors,
      productionDate: existing.productionDate,
    };
    const costSnapshot = this.calculateMenuProductionCostSnapshot(
      replacementInput,
      recipe,
    );
    const updated = await this.menuProductionModel
      .findOneAndUpdate(
        filter,
        {
          $set: {
            recipeId: recipe.id,
            recipeCode: recipe.recipeCode,
            recipeVersion: recipe.version,
            menuName: recipe.name,
            category: recipe.category,
            group: normalizedGroup,
            portion,
            cost: costSnapshot.estimatedTotalCost ?? 0,
            estimatedTotalCost: costSnapshot.estimatedTotalCost,
            estimatedCostPerPax: costSnapshot.estimatedCostPerPax,
            ingredientVendors: costSnapshot.ingredientVendors,
            approvalStatus: 'pending',
            storeRequestStatus: 'not-requested',
          },
          $unset: {
            rejectionReason: 1,
            reviewedBy: 1,
            approvedAt: 1,
            sellingPricePerPax: 1,
            sellingQuantity: 1,
            estimatedRevenue: 1,
            salesInputBy: 1,
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
    if (!updated) {
      throw new NotFoundException('Rejected menu production not found.');
    }

    const revisedBatch = await this.menuProductionModel
      .find(
        this.withSiteFilter(
          {
            productionCode: existing.productionCode,
            createdBy: normalizedChefId,
            isDraft: { $ne: true },
          },
          site,
        ),
      )
      .lean();
    const revisionComplete =
      revisedBatch.length > 0 &&
      revisedBatch.every((item) => item.approvalStatus !== 'rejected');
    if (revisionComplete) {
      const revisionFingerprint = createHash('sha256')
        .update(
          revisedBatch
            .map(
              (item) =>
                `${this.textValue(item._id)}:${this.textValue(item.recipeId)}:${item.approvalStatus}`,
            )
            .sort()
            .join('|'),
        )
        .digest('hex')
        .slice(0, 16);
      this.dispatchMenuProductionSubmissionNotifications(
        revisedBatch,
        `replacement-batch-${existing.productionCode}-${revisionFingerprint}`,
      );
    }

    return updated;
  }

  async updateSalesDetails(
    id: string,
    input: UpdateMenuProductionSalesDetailsDto,
    site?: string,
    salesInputBy?: string,
  ) {
    const sellingPricePerPax = Number(input.sellingPricePerPax);
    const sellingQuantity = Number(input.sellingQuantity);
    const actor = salesInputBy?.trim();
    if (
      !Number.isFinite(sellingPricePerPax) ||
      !Number.isFinite(sellingQuantity)
    ) {
      throw new BadRequestException('Sales details must be valid numbers.');
    }
    if (!actor) {
      throw new BadRequestException(
        'Admin identity is required for sales input.',
      );
    }

    const updated = await this.menuProductionModel.findOneAndUpdate(
      this.withSiteFilter(
        { _id: id, approvalStatus: 'pending', isDraft: { $ne: true } },
        site,
      ),
      {
        $set: {
          approvalStatus: 'pending',
          storeRequestStatus: 'not-requested',
          sellingPricePerPax,
          sellingQuantity,
          estimatedRevenue: this.roundQuantity(
            sellingPricePerPax * sellingQuantity,
          ),
          salesInputBy: actor,
        },
        $unset: { rejectionReason: 1, reviewedBy: 1, approvedAt: 1 },
      },
      { new: true },
    );
    if (!updated) {
      throw new NotFoundException(
        'Pending menu production not found for this site.',
      );
    }
    return updated;
  }

  async updateBatchSalesDetails(
    productionCode: string,
    input: UpdateMenuProductionBatchSalesDetailsDto,
    site?: string,
    salesInputBy?: string,
  ) {
    const normalizedCode = productionCode?.trim();
    const sellingPricePerPax = Number(input.sellingPricePerPax);
    const sellingQuantity = Number(input.sellingQuantity);
    const actor = salesInputBy?.trim();
    if (
      !normalizedCode ||
      !Number.isFinite(sellingPricePerPax) ||
      !Number.isFinite(sellingQuantity)
    ) {
      throw new BadRequestException(
        'Production batch sales details are invalid.',
      );
    }
    if (!actor) {
      throw new BadRequestException(
        'Admin identity is required for sales input.',
      );
    }

    const filter = this.withSiteFilter(
      {
        productionCode: normalizedCode,
        approvalStatus: 'pending',
        isDraft: { $ne: true },
      },
      site,
    );
    const result = await this.menuProductionModel.updateMany(filter, {
      $set: {
        approvalStatus: 'pending',
        storeRequestStatus: 'not-requested',
        sellingPricePerPax,
        sellingQuantity,
        estimatedRevenue: this.roundQuantity(
          sellingPricePerPax * sellingQuantity,
        ),
        salesInputBy: actor,
      },
      $unset: { rejectionReason: 1, reviewedBy: 1, approvedAt: 1 },
    });
    if (!result.matchedCount) {
      throw new NotFoundException(
        'Pending production batch not found for this site.',
      );
    }
    const batchFilter = this.withSiteFilter(
      {
        productionCode: normalizedCode,
        isDraft: { $ne: true },
      },
      site,
    );
    await this.menuProductionModel.updateMany(batchFilter, {
      $set: {
        sellingPricePerPax,
        sellingQuantity,
        estimatedRevenue: this.roundQuantity(
          sellingPricePerPax * sellingQuantity,
        ),
        salesInputBy: actor,
      },
    });
    const updatedItems = await this.menuProductionModel
      .find(batchFilter)
      .lean();
    const firstItem = updatedItems[0];
    if (firstItem) {
      this.notificationsService
        .createHierarchicalNotification(
          firstItem.createdBy || 'system',
          'Menu Production Ready For Approval',
          `Production batch ${normalizedCode} has completed sales input and is ready for Unit Manager approval.`,
          firstItem.site || 'global',
          'unit.manager',
          'MENU_PRODUCTION_APPROVAL_REQUESTS',
          { productionCode: normalizedCode },
        )
        .catch((error) =>
          this.logger.error(
            `Unit Manager sales submission notification failed: ${this.errorMessage(error)}`,
          ),
        );
    }
    void this.workflowMail
      .notifyMenuProductionsReadyForApproval(
        updatedItems.map((item) => this.toMailRecord(item)),
        `sales-resubmission-${Date.now()}`,
      )
      .catch((error) =>
        this.logger.error(
          `Unit Manager sales submission email failed: ${this.errorMessage(error)}`,
        ),
      );
    return updatedItems;
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
      const targetSite = item.site || site || 'global';

      this.notificationsService
        .createHierarchicalNotification(
          'system',
          'Store Request Materials Ready',
          `The materials for production batch ${item.productionCode || 'N/A'} have been fulfilled and are ready for pickup.`,
          targetSite, // 🌟 Updated to ensure it hits your specific site filter block
          'chef',
          'STORE_REQUEST_RECORDS',
          { productionCode: item.productionCode },
        )
        .catch((err) =>
          this.logger.error(
            `Chef fulfillment notification failed: ${this.errorMessage(err)}`,
          ),
        );

      // Your original tracking field logic remains exactly here:
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
      const key = this.buildStoreFulfillmentItemKey(
        item.productCode,
        item.name,
        item.unitOfMeasures,
        item.vendor,
        item.vendorSite,
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
        const key = this.buildStoreFulfillmentItemKey(
          plannedItem.productCode,
          plannedItem.name,
          plannedItem.unitOfMeasures,
          plannedItem.vendor,
          plannedItem.vendorSite,
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
        const plannedPrice = Number.isFinite(Number(plannedItem.price))
          ? Number(plannedItem.price)
          : undefined;
        const submittedActualPrice = Number(actualItem.actualPrice);
        const actualPrice = Number.isFinite(submittedActualPrice)
          ? submittedActualPrice
          : plannedPrice;
        const variancePrice =
          actualPrice !== undefined && plannedPrice !== undefined
            ? this.roundQuantity(actualPrice - plannedPrice)
            : undefined;
        const plannedIngredientCost = Number.isFinite(
          Number(
            plannedItem.plannedIngredientCost ?? plannedItem.ingredientCost,
          ),
        )
          ? Number(
              plannedItem.plannedIngredientCost ?? plannedItem.ingredientCost,
            )
          : undefined;
        const actualIngredientCost =
          actualPrice !== undefined
            ? this.roundQuantity(actualPrice * actualQty)
            : undefined;
        const normalizedReason = actualItem.reason?.trim();
        if (
          (varianceQty !== 0 ||
            (variancePrice !== undefined && variancePrice !== 0)) &&
          !normalizedReason
        ) {
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
          vendor: plannedItem.vendor,
          vendorSite: plannedItem.vendorSite,
          price: plannedItem.price,
          ingredientCost: plannedIngredientCost,
          plannedIngredientCost,
          actualIngredientCost,
          plannedPrice,
          actualPrice,
          variancePrice,
          reason: normalizedReason || undefined,
        };
      },
    );

    actualItems.forEach((actualItem) => {
      const actualQty = this.roundQuantity(Number(actualItem.actualQty));
      const actualPrice = Number.isFinite(Number(actualItem.actualPrice))
        ? Number(actualItem.actualPrice)
        : undefined;
      const actualIngredientCost =
        actualPrice !== undefined
          ? this.roundQuantity(actualPrice * actualQty)
          : undefined;
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
        vendor: actualItem.vendor?.trim() || undefined,
        vendorSite: actualItem.vendorSite?.trim() || undefined,
        plannedQty: 0,
        actualQty,
        varianceQty: actualQty,
        ingredientCost: 0,
        plannedIngredientCost: 0,
        actualIngredientCost,
        plannedPrice: 0,
        actualPrice,
        variancePrice: actualPrice,
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

    const filter: Record<string, unknown> = { isDraft: { $ne: true } };
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
    const recipeVersionById = new Map<string, number>();
    if (recipeIds.length) {
      const recipes = await this.recipeModel
        .find({ _id: { $in: recipeIds } })
        .select({ recipeCode: 1, version: 1 })
        .lean();
      recipes.forEach((recipe) => {
        const normalizedRecipeId = this.normalizeOptionalRecipeId(
          String(recipe._id ?? ''),
        );
        const recipeCode = this.normalizeOptionalRecipeCode(recipe.recipeCode);
        if (!normalizedRecipeId) return;
        if (recipeCode) recipeCodeById.set(normalizedRecipeId, recipeCode);
        recipeVersionById.set(
          normalizedRecipeId,
          this.normalizeRecipeVersion(recipe.version),
        );
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
        recipeVersion: this.normalizeRecipeVersion(
          item.recipeVersion ??
            (recipeId ? recipeVersionById.get(recipeId) : undefined),
        ),
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
    approvalReady = false,
  ) {
    await this.backfillMissingMenuProductionCodes();
    const requestedSite = this.normalizeSite(site);

    const filter: Record<string, unknown> = { isDraft: { $ne: true } };
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
    if (approvalReady) {
      andFilters.push({
        sellingPricePerPax: { $type: 'number', $gte: 0 },
        sellingQuantity: { $type: 'number', $gte: 0 },
      });
      filter.$and = andFilters;
    }
    const requestedApprovalStatus = query.approvalStatus;
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

    const filteredGroups = requestedApprovalStatus
      ? grouped.filter((group) =>
          group.items.some(
            (item) => item.approvalStatus === requestedApprovalStatus,
          ),
        )
      : grouped;

    return { items: filteredGroups };
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
        isActive: true,
      })
      .select({
        recipeCode: 1,
        version: 1,
        name: 1,
        category: 1,
        portionSize: 1,
        ingredients: 1,
      })
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
        version: this.normalizeRecipeVersion(recipe.version),
        name: recipe.name?.trim() ?? '',
        category: recipe.category?.trim() ?? '',
        portionSize: Number(recipe.portionSize),
        ingredients: (recipe.ingredients ?? []).map((ingredient) => ({
          ingredientType: ingredient.ingredientType,
          productCode: ingredient.productCode?.trim() ?? '',
          name: ingredient.name?.trim() ?? '',
          unitOfMeasures: ingredient.unitOfMeasures?.trim() ?? '',
          qty: Number(ingredient.qty),
          priceUom: Number(ingredient.priceUom),
          foodCost: Number(ingredient.foodCost),
        })),
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

  private buildStoreFulfillmentItemKey(
    productCode?: string,
    name?: string,
    unitOfMeasures?: string,
    vendor?: string,
    vendorSite?: string,
  ) {
    const ingredientKey = this.buildStoreIngredientKey(
      productCode,
      name,
      unitOfMeasures,
    );
    if (!ingredientKey) return '';

    return `${ingredientKey}__${this.normalizeName(vendor || '')}__${this.normalizeName(
      vendorSite || '',
    )}`;
  }

  private normalizeIngredientVendors(
    vendors?: MenuProductionIngredientVendor[],
  ): MenuProductionIngredientVendor[] {
    if (!Array.isArray(vendors)) return [];
    return vendors
      .map((vendor) => {
        const ingredientIndex = Number(vendor.ingredientIndex);
        const price = Number(vendor.price);
        const ingredientCost = Number(vendor.ingredientCost);
        const minimumQuantity = Number(vendor.minimumQuantity);
        return {
          ...(Number.isInteger(ingredientIndex) && ingredientIndex >= 0
            ? { ingredientIndex }
            : {}),
          productCode: vendor.productCode?.trim() || undefined,
          name: vendor.name?.trim() || undefined,
          unitOfMeasures: vendor.unitOfMeasures?.trim() || undefined,
          vendor: vendor.vendor?.trim() || undefined,
          site: vendor.site?.trim() || undefined,
          currency: vendor.currency?.trim() || undefined,
          ...(Number.isFinite(minimumQuantity) && minimumQuantity >= 0
            ? { minimumQuantity }
            : {}),
          ...(Number.isFinite(price) && price >= 0 ? { price } : {}),
          ...(Number.isFinite(ingredientCost) && ingredientCost >= 0
            ? { ingredientCost }
            : {}),
        };
      })
      .filter(
        (vendor) =>
          vendor.ingredientIndex !== undefined ||
          Boolean(vendor.productCode || vendor.name || vendor.vendor),
      );
  }

  private findIngredientVendor(
    vendors: MenuProductionIngredientVendor[],
    ingredientIndex: number,
    productCode?: string,
    name?: string,
    unitOfMeasures?: string,
  ) {
    const byIndex = vendors.find(
      (vendor) => vendor.ingredientIndex === ingredientIndex,
    );
    if (byIndex) return byIndex;

    const key = this.buildStoreIngredientKey(productCode, name, unitOfMeasures);
    if (!key) return undefined;
    return vendors.find(
      (vendor) =>
        this.buildStoreIngredientKey(
          vendor.productCode,
          vendor.name,
          vendor.unitOfMeasures,
        ) === key,
    );
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
      const plannedQty = Number(record.plannedQty);
      const actualQty = Number(record.actualQty);
      const storedVarianceQty = Number(record.varianceQty);
      const varianceQty =
        Number.isFinite(plannedQty) && Number.isFinite(actualQty)
          ? this.roundQuantity(actualQty - plannedQty)
          : Number.isFinite(storedVarianceQty)
            ? storedVarianceQty
            : 0;
      return {
        productCode: this.textValue(record.productCode).trim(),
        name: this.textValue(record.name).trim(),
        unitOfMeasures: this.textValue(record.unitOfMeasures).trim(),
        plannedQty: Number.isFinite(plannedQty) ? plannedQty : 0,
        actualQty: Number.isFinite(actualQty) ? actualQty : 0,
        varianceQty,
        vendor: this.textValue(record.vendor).trim() || undefined,
        vendorSite: this.textValue(record.vendorSite).trim() || undefined,
        price: Number.isFinite(Number(record.price))
          ? Number(record.price)
          : undefined,
        ingredientCost: Number.isFinite(Number(record.ingredientCost))
          ? Number(record.ingredientCost)
          : undefined,
        plannedIngredientCost: Number.isFinite(
          Number(record.plannedIngredientCost),
        )
          ? Number(record.plannedIngredientCost)
          : Number.isFinite(Number(record.ingredientCost))
            ? Number(record.ingredientCost)
            : undefined,
        actualIngredientCost: Number.isFinite(
          Number(record.actualIngredientCost),
        )
          ? Number(record.actualIngredientCost)
          : Number.isFinite(Number(record.actualPrice)) &&
              Number.isFinite(Number(record.actualQty))
            ? this.roundQuantity(
                Number(record.actualPrice) * Number(record.actualQty),
              )
            : undefined,
        plannedPrice: Number.isFinite(Number(record.plannedPrice))
          ? Number(record.plannedPrice)
          : undefined,
        actualPrice: Number.isFinite(Number(record.actualPrice))
          ? Number(record.actualPrice)
          : undefined,
        variancePrice: Number.isFinite(Number(record.variancePrice))
          ? Number(record.variancePrice)
          : undefined,
        reason: this.textValue(record.reason).trim() || undefined,
      };
    });
  }

  private async buildGroupedStoreRequestsFromMenus(
    items: Array<
      Partial<MenuProduction> & {
        _id?: unknown;
        id?: unknown;
        createdAt?: Date | string;
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
      if (!key) return;
      const existing = recipeByName.get(key);
      if (
        !existing ||
        this.normalizeRecipeVersion(recipe.version) <
          this.normalizeRecipeVersion(existing.version)
      ) {
        recipeByName.set(key, recipe);
      }
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
        id: this.textValue(menu._id ?? menu.id),
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
      const storedEstimatedCost = Number(menu.estimatedTotalCost);
      const storedEstimatedCostPerPax = Number(menu.estimatedCostPerPax);
      let estimatedCost: number | undefined =
        Number.isFinite(storedEstimatedCost) && storedEstimatedCost >= 0
          ? storedEstimatedCost
          : undefined;
      let estimatedCostPerPax: number | undefined =
        Number.isFinite(storedEstimatedCostPerPax) &&
        storedEstimatedCostPerPax >= 0
          ? storedEstimatedCostPerPax
          : undefined;
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
      const resolvedRecipeVersion = this.normalizeRecipeVersion(
        menu.recipeVersion ?? (menuRecipeId ? recipe?.version : undefined),
      );

      if (!recipe) {
        missingRecipe = true;
        if (menu.menuName) {
          group.missingRecipes.add(String(menu.menuName));
        }
      } else {
        portionSize = Number(recipe.portionSize) || 1;
        if (portionSize <= 0) portionSize = 1;
        const multiplier = Number(menu.portion) / portionSize;
        let estimatedCostTotal = 0;
        let hasEstimatedCost = false;
        const ingredientVendors = this.normalizeIngredientVendors(
          menu.ingredientVendors,
        );

        ingredients = (recipe.ingredients ?? []).map((ingredient, index) => {
          const productCode = ingredient.productCode?.trim() ?? '';
          const name = ingredient.name?.trim() ?? '';
          const unitOfMeasures = ingredient.unitOfMeasures?.trim() ?? '';
          const baseQty = Number(ingredient.qty);
          const qty = this.roundQuantity(
            (Number.isFinite(baseQty) ? baseQty : 0) * multiplier,
          );
          const selectedVendor = this.findIngredientVendor(
            ingredientVendors,
            index,
            productCode,
            name,
            unitOfMeasures,
          );
          const priceUom = Number(ingredient.priceUom);
          const foodCost = Number(ingredient.foodCost);
          const vendorPrice = Number(selectedVendor?.price);
          const unitPrice = Number.isFinite(vendorPrice)
            ? vendorPrice
            : Number.isFinite(priceUom)
              ? priceUom
              : Number.isFinite(foodCost) &&
                  Number.isFinite(baseQty) &&
                  baseQty > 0
                ? foodCost / baseQty
                : undefined;
          const storedIngredientCost = Number(selectedVendor?.ingredientCost);
          const ingredientCost =
            Number.isFinite(storedIngredientCost) && storedIngredientCost >= 0
              ? storedIngredientCost
              : unitPrice !== undefined
                ? qty * unitPrice
                : undefined;
          if (ingredientCost !== undefined) {
            estimatedCostTotal += ingredientCost ?? 0;
            hasEstimatedCost = true;
          }
          const normalizedKey = this.buildStoreFulfillmentItemKey(
            productCode,
            name,
            unitOfMeasures,
            selectedVendor?.vendor,
            selectedVendor?.site,
          );
          // Recipe ingredients are already site-scoped. Aggregate IT rows by
          // product/UOM/vendor only; vendorSite must not split equal vendors.
          // Older IT recipes may not have ingredientType, so infer it from the
          // IT product-code prefix. NMP ingredients must remain separate.
          const isNmpProductCode = productCode.toUpperCase() === 'NMP';
          const isItIngredient =
            ingredient.ingredientType === 'IT' ||
            (!ingredient.ingredientType &&
              productCode.toUpperCase().startsWith('IT'));
          const summaryIngredientKey = this.buildStoreIngredientKey(
            productCode,
            name,
            unitOfMeasures,
          );
          const summaryKey =
            isItIngredient && !isNmpProductCode
              ? `${summaryIngredientKey}__${this.normalizeName(
                  selectedVendor?.vendor || '',
                )}`
              : `nmp__${group.summaryMap.size}__${normalizedKey}`;
          const existing = group.summaryMap.get(summaryKey);
          if (existing) {
            existing.qty += qty;
            if (ingredientCost !== undefined) {
              existing.ingredientCost =
                (existing.ingredientCost ?? 0) + ingredientCost;
              existing.plannedIngredientCost =
                (existing.plannedIngredientCost ?? 0) + ingredientCost;
            }
            if (existing.vendor !== selectedVendor?.vendor) {
              existing.vendor = existing.vendor
                ? 'Multiple'
                : selectedVendor?.vendor;
            }
            if (existing.vendorSite !== selectedVendor?.site) {
              existing.vendorSite = undefined;
            }
            if (existing.price !== unitPrice) {
              existing.price = undefined;
            }
          } else {
            group.summaryMap.set(summaryKey, {
              ingredientType: isItIngredient ? 'IT' : ingredient.ingredientType,
              productCode,
              name,
              unitOfMeasures,
              qty,
              vendor: selectedVendor?.vendor,
              vendorSite: selectedVendor?.site,
              price: unitPrice,
              ingredientCost,
              plannedIngredientCost: ingredientCost,
            });
          }

          return {
            ingredientType: isItIngredient ? 'IT' : ingredient.ingredientType,
            productCode,
            name,
            unitOfMeasures,
            qty,
            vendor: selectedVendor?.vendor,
            vendorSite: selectedVendor?.site,
            price: unitPrice,
            ingredientCost,
            plannedIngredientCost: ingredientCost,
          };
        });
        estimatedCost =
          Number.isFinite(storedEstimatedCost) && storedEstimatedCost >= 0
            ? storedEstimatedCost
            : hasEstimatedCost
              ? estimatedCostTotal
              : undefined;
        estimatedCostPerPax =
          Number.isFinite(storedEstimatedCostPerPax) &&
          storedEstimatedCostPerPax >= 0
            ? storedEstimatedCostPerPax
            : estimatedCost !== undefined && Number(menu.portion) > 0
              ? estimatedCost / Number(menu.portion)
              : undefined;
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
        id: this.textValue(menu._id ?? menu.id),
        site: this.normalizeSite(String(menu.site ?? '')) ?? group.site,
        productionCode: this.normalizeOptionalProductionCode(
          String(menu.productionCode ?? ''),
        ),
        submittedByName,
        reviewedBy,
        submittedAt: menu.submittedAt
          ? new Date(String(menu.submittedAt)).toISOString()
          : menu.createdAt
            ? new Date(String(menu.createdAt)).toISOString()
            : undefined,
        approvedAt: menu.approvedAt
          ? new Date(String(menu.approvedAt)).toISOString()
          : undefined,
        recipeId: resolvedRecipeId,
        recipeCode: resolvedRecipeCode,
        recipeVersion: resolvedRecipeVersion,
        menuName: String(menu.menuName ?? ''),
        clientName: String(menu.clientName ?? '').trim() || undefined,
        category: String(menu.category ?? ''),
        group: String(menu.group ?? '').trim() || undefined,
        portion: Number(menu.portion ?? 0),
        cost: Number.isFinite(Number(menu.cost))
          ? Number(menu.cost)
          : undefined,
        estimatedCost,
        estimatedCostPerPax,
        sellingPricePerPax: Number.isFinite(Number(menu.sellingPricePerPax))
          ? Number(menu.sellingPricePerPax)
          : undefined,
        sellingQuantity: Number.isFinite(Number(menu.sellingQuantity))
          ? Number(menu.sellingQuantity)
          : undefined,
        salesInputBy: String(menu.salesInputBy ?? '').trim() || undefined,
        estimatedRevenue: Number.isFinite(Number(menu.estimatedRevenue))
          ? Number(menu.estimatedRevenue)
          : undefined,
        productionDate,
        approvalStatus: menu.approvalStatus ?? 'pending',
        rejectionReason: String(menu.rejectionReason ?? '').trim() || undefined,
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
