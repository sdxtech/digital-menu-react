import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import ExcelJS, { type CellValue, type Worksheet } from 'exceljs';
import { Model } from 'mongoose';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { ListRecipesQueryDto } from './dto/list-recipes.query.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import {
  ApprovalStatus,
  Recipe,
  RecipeDocument,
  RecipeIngredient,
} from './schemas/recipe.schema';
import {
  RecipeCodeCounter,
  RecipeCodeCounterDocument,
} from './schemas/recipe-code-counter.schema';
import {
  RawMaterialsService,
  type RawMaterialLookup,
} from '../raw-materials/raw-materials.service';
import { SitesService } from '../sites/sites.service';
import { UsersService } from '../users/users.service';
import { AppRole } from '../auth/roles.constants';
import { UnitOfMeasuresService } from '../unit-of-measures/unit-of-measures.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkflowMailService } from '../mail/workflow-mail.service';

const QUANTITY_DECIMAL_PLACES = 6;

type RecipeActor = {
  id?: string;
  name?: string;
  email?: string;
  site?: string;
  sites?: string[];
  roles?: AppRole[];
};

type RecipeAuditFields = {
  createdBy?: string;
  updatedBy?: string;
  reviewedBy?: string;
  createdByName?: string;
  updatedByName?: string;
  reviewedByName?: string;
};

type RecipeVersionMetadata = {
  name: string;
  version: number;
  versionGroupId: string;
  parentRecipeId?: string;
};

type ImportWarningCode =
  | 'missing_product_code'
  | 'missing_uom'
  | 'raw_material_not_found'
  | 'conversion_not_possible'
  | 'invalid_portion'
  | 'missing_name'
  | 'missing_header'
  | 'legacy_row_skipped';

type RecipeImportWarning = {
  code: ImportWarningCode;
  message: string;
  row?: number;
  recipeName?: string;
};

type RecipeImportFallbackRows = {
  missingProductCode: number;
  missingUom: number;
  rawMaterialNotFound: number;
  conversionNotPossible: number;
};

export type RecipeImportResult = {
  insertedCount: number;
  ingredientsCount: number;
  warningsCount: number;
  warnings?: RecipeImportWarning[];
  fallbackRows: RecipeImportFallbackRows;
};

type RecipeImportParseResult = {
  records: ImportRecipeRecord[];
  warnings: RecipeImportWarning[];
  fallbackRows: RecipeImportFallbackRows;
  ingredientsCount: number;
};

type ImportRecipeRecord = Omit<CreateRecipeDto, 'ingredients'> & {
  ingredients?: RecipeIngredient[];
};

type RecipeCardHeaderMap = {
  headerRow: number;
  qtyCol: number;
  productCodeCol: number;
  ingredientCol?: number;
  productDescriptionCol?: number;
  unitLeftCol?: number;
  unitRightCol?: number;
  priceUomCol?: number;
  foodCostCol?: number;
};

type RecipeCardBlock = {
  index: number;
  startRow: number;
  endRow: number;
};

type BlockMeta = {
  recipeName: string;
  category: string;
  portionSize: number;
};

const DEFAULT_WARNING_LIMIT = 120;

const LEGACY_HEADER_ALIASES = {
  name: ['name', 'nama', 'menu', 'menu name'],
  category: ['category', 'kategori', 'jenis'],
  description: ['description', 'deskripsi', 'desc'],
  price: ['price', 'harga'],
  status: ['status', 'state'],
  portionSize: ['portion', 'portions', 'porsi', 'serving', 'servings', 'yield'],
  foodCostRecipe: ['food cost recipe', 'food cost', 'total cost'],
} as const;

type LegacyHeaderKey = keyof typeof LEGACY_HEADER_ALIASES;
type LegacyHeaderMap = Partial<Record<LegacyHeaderKey, number>>;
type LabelCell = { row: number; col: number };

const UOM_ALIASES: Record<string, string> = {
  g: 'gram',
  gr: 'gram',
  gram: 'gram',
  grams: 'gram',
  kg: 'kg',
  kgs: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  l: 'liter',
  lt: 'liter',
  ltr: 'liter',
  liter: 'liter',
  litre: 'liter',
  litres: 'liter',
  liters: 'liter',
  pcs: 'pcs',
  pc: 'pcs',
  piece: 'pcs',
  pieces: 'pcs',
  unit: 'pcs',
};

const RECIPE_CODE_PREFIX = 'RCP';
const RECIPE_CODE_MIN_DIGITS = 4;
const RECIPE_CODE_COUNTER_KEY = 'recipe_code';

@Injectable()
export class RecipesService {
  private readonly logger = new Logger(RecipesService.name);

  constructor(
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    @InjectModel(RecipeCodeCounter.name)
    private readonly recipeCodeCounterModel: Model<RecipeCodeCounterDocument>,
    private readonly rawMaterials: RawMaterialsService,
    private readonly users: UsersService,
    private readonly sites: SitesService,
    private readonly unitOfMeasures: UnitOfMeasuresService,
    private readonly notificationsService: NotificationsService, // 🌟 ADDED
    private readonly workflowMail: WorkflowMailService,
  ) {}

  async create(input: CreateRecipeDto, actor?: RecipeActor) {
    const normalizedName = input.name.trim();
    if (!input.baseRecipeId) {
      const duplicate = await this.recipeModel.exists({
        deletedAt: { $exists: false },
        name: new RegExp(`^${this.escapeRegExp(normalizedName)}$`, 'i'),
      });
      if (duplicate) {
        throw new ConflictException(
          'A recipe with this name already exists. Please use a different name.',
        );
      }
    }

    const ingredients = await this.applyIngredientUomConversions(
      this.normalizeIngredients(input.ingredients),
    );
    const normalizedSite = this.normalizeSite(actor?.site);
    await this.validateSiteScopedIngredients(ingredients, normalizedSite);
    const costFields = await this.buildIngredientCostUpdate(ingredients);
    const inputFoodCostRecipe = this.normalizeOptionalNumber(
      input.foodCostRecipe,
    );
    const imageUrl = input.imageUrl?.trim();
    const recipeCode = await this.nextRecipeCode();
    const versionMetadata = await this.resolveRecipeVersionMetadata(
      input,
      recipeCode,
    );

    const createdFields = this.buildActorFields(actor, 'created');
    const updatedFields = this.buildActorFields(actor, 'updated');
    const isSuperadminActor = this.isSuperadminActor(actor);
    const isCorporateChefActor = this.isCorporateChefActor(actor);
    const isApproverActor = isSuperadminActor || isCorporateChefActor;
    const saveAsDraft = !isSuperadminActor && input.saveAsDraft === true;
    const autoApprove = isApproverActor && !saveAsDraft;
    const reviewedFields = autoApprove
      ? this.buildActorFields(actor, 'reviewed')
      : {};

    // 1. We now save the created recipe document to a variable named 'saved'
    const saved = await this.recipeModel.create({
      recipeCode,
      name: versionMetadata.name,
      version: versionMetadata.version,
      versionGroupId: versionMetadata.versionGroupId,
      ...(versionMetadata.parentRecipeId
        ? { parentRecipeId: versionMetadata.parentRecipeId }
        : {}),
      category: input.category.trim(),
      description: input.description?.trim(),
      imageUrl: imageUrl || undefined,
      price: input.price ?? 0,
      portionSize: input.portionSize ?? 1,
      ...(inputFoodCostRecipe !== undefined
        ? { foodCostRecipe: inputFoodCostRecipe }
        : 'foodCostRecipe' in costFields
          ? { foodCostRecipe: costFields.foodCostRecipe }
          : {}),
      status: autoApprove ? 'active' : (input.status ?? 'draft'),
      approvalStatus: autoApprove ? 'approved' : 'pending',
      isDraft: saveAsDraft,
      ...(autoApprove ? { reviewedAt: new Date() } : {}),
      ingredients: costFields.ingredients,
      ...createdFields,
      ...updatedFields,
      ...reviewedFields,
      ...(normalizedSite ? { site: normalizedSite } : {}),
    });

    // 2. 🚀 Trigger real-time notification to the UNIT MANAGER
    if (!isApproverActor && !saveAsDraft) {
      try {
        for (const targetRole of ['unit.manager', 'corporate-chef'] as const) {
          await this.notificationsService.createHierarchicalNotification(
            actor?.id || 'system',
            'New Recipe Pending Approval',
            `A new recipe "${saved.name}" V${saved.version ?? versionMetadata.version} has been submitted by the Chef and requires review.`,
            saved.site || 'global',
            targetRole,
            'RECIPE_APPROVAL_REQUESTS',
            { recipeId: saved._id?.toString() },
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `Unit Manager recipe creation notification failed: ${message}`,
        );
      }

      void this.workflowMail
        .notifyRecipeSubmitted({
          id: saved._id.toString(),
          name: saved.name,
          recipeCode: saved.recipeCode,
          version: saved.version,
          site: saved.site,
          createdBy: saved.createdBy,
          createdByEmail: saved.createdByEmail,
        })
        .catch((error) =>
          this.logger.error(
            `Recipe submission email failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }

    // 3. Return the saved document exactly as the old code did
    return saved;
  }

  private async validateSiteScopedIngredients(
    ingredients: RecipeIngredient[],
    site?: string,
  ) {
    if (!site) return;

    const itProductCodes = Array.from(
      new Set(
        ingredients
          .filter((ingredient) => ingredient.ingredientType === 'IT')
          .map((ingredient) => ingredient.productCode?.trim())
          .filter((code): code is string => Boolean(code)),
      ),
    );
    if (itProductCodes.length === 0) return;

    const availableCodes = new Set(
      (
        await this.rawMaterials.findAvailableNormalizedCodesForSite(
          itProductCodes,
          site,
        )
      ).map((code) => String(code).trim().toLowerCase()),
    );
    const unavailableCodes = itProductCodes.filter(
      (code) => !availableCodes.has(code.toLowerCase()),
    );
    if (unavailableCodes.length) {
      throw new BadRequestException(
        `Raw material ${unavailableCodes.join(', ')} is not available for site ${site}.`,
      );
    }
  }

  async findAll(query: ListRecipesQueryDto, site?: string) {
    const filter: Record<string, unknown> = {
      deletedAt: { $exists: false },
      isDraft: { $ne: true },
    };
    const andFilters: Record<string, unknown>[] = [];
    const visibilityFilter =
      query.strictSite === 'true'
        ? this.buildSiteFilter(site)
        : this.buildVisibilityFilter(site, query.approvalStatus);
    if (Object.keys(visibilityFilter).length) {
      andFilters.push(visibilityFilter);
    }

    await this.backfillMissingRecipeCodes();

    if (query.search?.trim()) {
      const text = query.search.trim();
      andFilters.push({
        $or: [
          { recipeCode: new RegExp(this.escapeRegExp(text), 'i') },
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
      (item) => item.approvalStatus === 'approved' && item.status !== 'active',
    );
    if (needsSync) {
      const syncFilter = {
        deletedAt: { $exists: false },
        approvalStatus: 'approved',
        status: { $ne: 'active' },
      };
      await this.recipeModel.updateMany(syncFilter, {
        $set: { status: 'active' },
      });
      items.forEach((item) => {
        if (item.approvalStatus === 'approved' && item.status !== 'active') {
          item.status = 'active';
        }
      });
    }

    items.forEach((item) => {
      item.version = this.normalizeRecipeVersion(item.version);
      if (!item.versionGroupId?.trim()) {
        item.versionGroupId = item.recipeCode?.trim() || String(item._id);
      }
    });

    await this.attachActorNames(items);
    await this.attachSiteNames(items);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async findDrafts(actor?: RecipeActor) {
    if (!actor?.id) {
      throw new BadRequestException(
        'Recipe author identity is required to load drafts.',
      );
    }

    const items = await this.recipeModel
      .find(
        this.withSiteFilter(
          {
            createdBy: actor.id,
            isDraft: true,
            deletedAt: { $exists: false },
          },
          this.getActorSiteScope(actor),
        ),
      )
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    await this.attachActorNames(items);
    await this.attachSiteNames(items);
    return { items, total: items.length };
  }

  async submitDraft(id: string, actor?: RecipeActor) {
    if (!actor?.id) {
      throw new BadRequestException(
        'Recipe author identity is required to submit a draft.',
      );
    }

    const filter = this.withSiteFilter(
      {
        _id: id,
        createdBy: actor.id,
        isDraft: true,
        deletedAt: { $exists: false },
      },
      this.getActorSiteScope(actor),
    );
    const existing = await this.recipeModel.findOne(filter).lean();
    if (!existing) throw new NotFoundException('Recipe draft not found');
    if (!existing.name?.trim() || !existing.category?.trim()) {
      throw new BadRequestException('Recipe name and category are required.');
    }
    if (!existing.ingredients?.length) {
      throw new BadRequestException(
        'Add at least 1 ingredient before submitting the recipe.',
      );
    }

    const isCorporateChefActor = this.isCorporateChefActor(actor);
    const reviewedFields = isCorporateChefActor
      ? this.buildActorFields(actor, 'reviewed')
      : {};
    const updated = await this.recipeModel
      .findOneAndUpdate(
        filter,
        {
          $set: {
            isDraft: false,
            status: isCorporateChefActor ? 'active' : 'draft',
            approvalStatus: isCorporateChefActor ? 'approved' : 'pending',
            ...this.buildActorFields(actor, 'updated'),
            ...(isCorporateChefActor
              ? { reviewedAt: new Date(), ...reviewedFields }
              : {}),
          },
        },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Recipe draft not found');

    if (!isCorporateChefActor) {
      try {
        for (const targetRole of ['unit.manager', 'corporate-chef'] as const) {
          await this.notificationsService.createHierarchicalNotification(
            actor.id,
            'New Recipe Pending Approval',
            `A new recipe "${updated.name}" V${updated.version ?? 1} has been submitted by the Chef and requires review.`,
            updated.site || 'global',
            targetRole,
            'RECIPE_APPROVAL_REQUESTS',
            { recipeId: updated._id?.toString() },
          );
        }
      } catch (error) {
        this.logger.error(
          `Recipe draft submission notification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (!isCorporateChefActor) {
      void this.workflowMail
        .notifyRecipeSubmitted({
          id: updated._id.toString(),
          name: updated.name,
          recipeCode: updated.recipeCode,
          version: updated.version,
          site: updated.site,
          createdBy: updated.createdBy,
          createdByEmail: updated.createdByEmail,
        })
        .catch((error) =>
          this.logger.error(
            `Recipe draft submission email failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }

    return updated;
  }

  async setActive(id: string, isActive: boolean, actor?: RecipeActor) {
    const updatedFields = this.buildActorFields(actor, 'updated');
    const updated = await this.recipeModel
      .findOneAndUpdate(
        this.withSiteFilter(
          { _id: id, deletedAt: { $exists: false } },
          actor?.site,
        ),
        {
          $set: {
            isActive,
            ...updatedFields,
          },
        },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Recipe not found');
    return updated;
  }

  async softDeleteById(id: string, actor?: RecipeActor) {
    const updatedFields = this.buildActorFields(actor, 'updated');
    const updated = await this.recipeModel
      .findOneAndUpdate(
        this.withSiteFilter(
          { _id: id, deletedAt: { $exists: false } },
          actor?.site,
        ),
        {
          $set: {
            isActive: false,
            deletedAt: new Date(),
            ...updatedFields,
          },
        },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Recipe not found');
    return { id: String(updated._id), recipeCode: updated.recipeCode };
  }

  async setApprovalStatus(
    id: string,
    status: ApprovalStatus,
    actor?: RecipeActor,
    rejectionReason?: string,
  ) {
    // BACKEND LOGIC: approval updates also update recipe status.
    const nextStatus = status === 'approved' ? 'active' : 'draft';
    const reason = rejectionReason?.trim();
    if (status === 'rejected' && !reason) {
      throw new BadRequestException('Rejection reason is required.');
    }

    const filter = this.withSiteFilter(
      {
        _id: id,
        ...(this.isSuperadminActor(actor) ? {} : { approvalStatus: 'pending' }),
      },
      this.isCorporateChefActor(actor) ? actor?.sites : actor?.site,
    );
    const updatedFields = this.buildActorFields(actor, 'updated');
    const reviewedFields = this.buildActorFields(actor, 'reviewed');
    const existing =
      status === 'approved'
        ? await this.recipeModel
            .findOne(filter)
            .select({ ingredients: 1 })
            .lean()
        : null;
    if (status === 'approved' && !existing) {
      throw new NotFoundException('Recipe not found');
    }
    const costFields =
      status === 'approved' && existing
        ? await this.buildIngredientCostUpdate(existing.ingredients ?? [])
        : {};
    const updatePayload: Record<string, unknown> = {
      $set: {
        approvalStatus: status,
        status: nextStatus,
        reviewedAt: new Date(),
        ...costFields,
        ...updatedFields,
        ...reviewedFields,
        ...(status === 'rejected' ? { rejectionReason: reason } : {}),
      },
    };
    if (status === 'rejected') {
      updatePayload.$push = {
        approvalHistory: {
          rejectionReason: reason,
          rejectedBy: actor?.id,
          rejectedByName: actor?.name,
          rejectedByEmail: actor?.email,
          rejectedAt: new Date(),
        },
      };
    }
    if (status === 'approved') {
      updatePayload.$unset = { rejectionReason: '' };
    }
    const updated = await this.recipeModel
      .findOneAndUpdate(filter, updatePayload, { new: true })
      .lean();
    if (!updated) throw new NotFoundException('Recipe not found');

    // 🚀 INJECTED: Trigger real-time notification upon successful approval
    if (status === 'approved') {
      try {
        const reviewerLabel = this.isSuperadminActor(actor)
          ? 'Superadmin'
          : this.isCorporateChefActor(actor)
            ? 'Corporate Chef'
            : 'Unit Manager';
        await this.notificationsService.createHierarchicalNotification(
          actor?.id || 'system',
          'New Recipe Approved',
          `The recipe "${updated.name}" has been approved by the ${reviewerLabel} and is ready for raw material staging.`,
          updated.site || 'global',
          'chef', // target role is chef
          'RECIPE_DATA_BANK',
          { recipeId: updated._id?.toString() },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`chef recipe approval notification failed: ${message}`);
      }
    }

    if (status !== 'pending') {
      void this.workflowMail
        .notifyRecipeDecision(
          {
            id: String(updated._id),
            name: updated.name,
            recipeCode: updated.recipeCode,
            version: updated.version,
            site: updated.site,
            createdBy: updated.createdBy,
            createdByEmail: updated.createdByEmail,
          },
          status,
          reason,
        )
        .catch((error) =>
          this.logger.error(
            `Recipe decision email failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }

    return updated;
  }

  async backfillApprovedIngredientCosts(actor?: RecipeActor) {
    const recipes = await this.recipeModel
      .find({
        deletedAt: { $exists: false },
        approvalStatus: 'approved',
        'ingredients.0': { $exists: true },
      })
      .select({ ingredients: 1, foodCostRecipe: 1 })
      .lean();

    const productCodes = recipes.flatMap((recipe) =>
      (recipe.ingredients ?? [])
        .map((ingredient) => ingredient.productCode?.trim() ?? '')
        .filter(Boolean),
    );
    const rawMaterialLookups =
      await this.rawMaterials.findLookupsByNormalizedCodes(productCodes);
    const rawMaterialByCode = new Map(
      rawMaterialLookups.map((item) => [item.productCodeNormalized, item]),
    );
    const updatedFields = this.buildActorFields(actor, 'updated');

    let updatedRecipes = 0;
    let updatedIngredients = 0;
    let skippedNoRawMaterial = 0;
    let skippedMissingPrice = 0;

    for (const recipe of recipes) {
      let changed = false;
      const ingredients = (recipe.ingredients ?? []).map((ingredient) => {
        const result = this.applyIngredientCostFromLookup(
          ingredient,
          rawMaterialByCode,
        );
        if (result.status === 'missing_raw_material') {
          skippedNoRawMaterial += 1;
          return ingredient;
        }
        if (result.status === 'missing_price') {
          skippedMissingPrice += 1;
          return ingredient;
        }
        if (result.changed) {
          changed = true;
          updatedIngredients += 1;
        }
        return result.ingredient;
      });

      const foodCostRecipe = this.calculateFoodCostRecipe(ingredients);
      const nextFoodCostRecipe =
        foodCostRecipe > 0 ? this.roundQuantity(foodCostRecipe) : undefined;
      const currentFoodCostRecipe = this.normalizeOptionalNumber(
        recipe.foodCostRecipe,
      );

      if (!changed && currentFoodCostRecipe === nextFoodCostRecipe) continue;

      const updatePayload: Record<string, unknown> = {
        $set: {
          ingredients,
          ...updatedFields,
        },
      };
      if (nextFoodCostRecipe !== undefined) {
        updatePayload.$set = {
          ...(updatePayload.$set as Record<string, unknown>),
          foodCostRecipe: nextFoodCostRecipe,
        };
      } else {
        updatePayload.$unset = { foodCostRecipe: '' };
      }

      await this.recipeModel.updateOne({ _id: recipe._id }, updatePayload);
      updatedRecipes += 1;
    }

    return {
      scannedRecipes: recipes.length,
      updatedRecipes,
      updatedIngredients,
      skippedNoRawMaterial,
      skippedMissingPrice,
    };
  }

  async resubmitRejectedRecipe(
    id: string,
    actor?: RecipeActor,
    feedback?: string,
  ) {
    const trimmedFeedback = feedback?.trim();
    if (!trimmedFeedback) {
      throw new BadRequestException('Resubmission feedback is required.');
    }

    const existing = await this.recipeModel
      .findOne(this.withSiteFilter({ _id: id }, actor?.site))
      .lean();
    if (!existing) throw new NotFoundException('Recipe not found');
    if (existing.approvalStatus !== 'rejected') {
      throw new BadRequestException(
        'Only rejected recipes can be resubmitted.',
      );
    }

    const updatedFields = this.buildActorFields(actor, 'updated');
    const approvalHistory = existing.approvalHistory ?? [];
    const lastHistoryIndex = approvalHistory.length - 1;
    const updatePayload: Record<string, unknown> = {
      $set: {
        approvalStatus: 'pending',
        status: 'draft',
        ...updatedFields,
      },
      $unset: {
        rejectionReason: '',
        reviewedBy: '',
        reviewedByName: '',
        reviewedByEmail: '',
        reviewedAt: '',
      },
    };

    if (lastHistoryIndex >= 0) {
      Object.assign(updatePayload.$set as Record<string, unknown>, {
        [`approvalHistory.${lastHistoryIndex}.resubmissionFeedback`]:
          trimmedFeedback,
        [`approvalHistory.${lastHistoryIndex}.resubmittedBy`]: actor?.id,
        [`approvalHistory.${lastHistoryIndex}.resubmittedByName`]: actor?.name,
        [`approvalHistory.${lastHistoryIndex}.resubmittedByEmail`]:
          actor?.email,
        [`approvalHistory.${lastHistoryIndex}.resubmittedAt`]: new Date(),
      });
    } else {
      updatePayload.$push = {
        approvalHistory: {
          rejectionReason: existing.rejectionReason?.trim() || 'Rejected',
          rejectedBy: existing.reviewedBy,
          rejectedByName: existing.reviewedByName,
          rejectedByEmail: existing.reviewedByEmail,
          rejectedAt: existing.reviewedAt ?? new Date(),
          resubmissionFeedback: trimmedFeedback,
          resubmittedBy: actor?.id,
          resubmittedByName: actor?.name,
          resubmittedByEmail: actor?.email,
          resubmittedAt: new Date(),
        },
      };
    }

    const updated = await this.recipeModel
      .findOneAndUpdate(
        this.withSiteFilter(
          { _id: id, approvalStatus: 'rejected' },
          actor?.site,
        ),
        updatePayload,
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Recipe not found');

    // 🚀 INJECTED: Trigger real-time hierarchical notification for the Unit Manager dashboard
    try {
      await this.notificationsService.createHierarchicalNotification(
        actor?.id || 'system',
        'Recipe Resubmitted for Review',
        `The recipe "${updated.name}" has been modified and resubmitted by the Chef for your approval.`,
        updated.site || actor?.site || 'global',
        'unit.manager', // 🌟 targetUserRole target
        'RECIPE_APPROVAL_REQUESTS',
        { recipeId: updated._id?.toString() },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Catch layout errors cleanly so the core recipe submission state doesn't crash if database updates experience lag
      console.error(`Manager recipe notification failed: ${message}`);
    }

    void this.workflowMail
      .notifyRecipeSubmitted(
        {
          id: String(updated._id),
          name: updated.name,
          recipeCode: updated.recipeCode,
          version: updated.version,
          site: updated.site,
          createdBy: updated.createdBy,
          createdByEmail: updated.createdByEmail,
        },
        true,
      )
      .catch((error) =>
        this.logger.error(
          `Recipe resubmission email failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );

    return updated;
  }

  async updateById(id: string, input: UpdateRecipeDto, actor?: RecipeActor) {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Recipe name is required.');
      $set.name = name;
    }

    if (input.category !== undefined) {
      const category = input.category.trim();
      if (!category) throw new BadRequestException('Category is required.');
      $set.category = category;
    }

    if (input.description !== undefined) {
      const description = input.description.trim();
      if (!description) {
        $unset.description = '';
      } else {
        $set.description = description;
      }
    }

    if (input.imageUrl !== undefined) {
      const imageUrl = input.imageUrl.trim();
      if (!imageUrl) {
        $unset.imageUrl = '';
      } else {
        $set.imageUrl = imageUrl;
      }
    }

    if (input.price !== undefined) {
      $set.price = input.price;
    }

    if (input.portionSize !== undefined) {
      $set.portionSize = input.portionSize;
    }

    const inputFoodCostRecipe =
      input.foodCostRecipe !== undefined
        ? this.normalizeOptionalNumber(input.foodCostRecipe)
        : undefined;
    if (inputFoodCostRecipe !== undefined) {
      $set.foodCostRecipe = inputFoodCostRecipe;
    }

    if (input.ingredients !== undefined) {
      const ingredients = await this.applyIngredientUomConversions(
        this.normalizeIngredients(input.ingredients),
      );
      const costFields = await this.buildIngredientCostUpdate(ingredients);
      $set.ingredients = costFields.ingredients;
      if (inputFoodCostRecipe === undefined) {
        if ('foodCostRecipe' in costFields) {
          $set.foodCostRecipe = costFields.foodCostRecipe;
        } else {
          $unset.foodCostRecipe = '';
        }
      }
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      throw new BadRequestException('No fields to update.');
    }

    const isCorporateChefActor = this.isCorporateChefActor(actor);
    const corporateSiteScope = this.getActorSiteScope(actor);
    if (isCorporateChefActor && !corporateSiteScope) {
      throw new BadRequestException(
        'Corporate Chef must be assigned to a site before editing recipes.',
      );
    }
    const updatedFields = this.buildActorFields(actor, 'updated');
    const preserveDraft = input.saveAsDraft === true;
    const autoApprove = isCorporateChefActor && !preserveDraft;
    const reviewedFields = autoApprove
      ? this.buildActorFields(actor, 'reviewed')
      : {};
    const updatePayload: Record<string, unknown> = {
      $set: {
        ...$set,
        ...updatedFields,
        ...(autoApprove
          ? {
              approvalStatus: 'approved',
              status: 'active',
              reviewedAt: new Date(),
              ...reviewedFields,
            }
          : {}),
      },
    };

    if (Object.keys($unset).length) {
      updatePayload.$unset = $unset;
    }

    const updated = await this.recipeModel
      .findOneAndUpdate(
        this.withSiteFilter(
          {
            _id: id,
            ...(isCorporateChefActor
              ? preserveDraft
                ? { isDraft: true, createdBy: actor?.id }
                : { approvalStatus: 'pending' }
              : {}),
            ...(actor?.roles?.includes(AppRole.Chef)
              ? {
                  $or: [{ isDraft: { $ne: true } }, { createdBy: actor.id }],
                }
              : {}),
          },
          isCorporateChefActor ? corporateSiteScope : actor?.site,
        ),
        updatePayload,
        {
          new: true,
        },
      )
      .lean();
    if (!updated) throw new NotFoundException('Recipe not found');

    return updated;
  }

  async bulkCreate(
    records: Array<
      Omit<CreateRecipeDto, 'ingredients'> & {
        ingredients?: RecipeIngredient[];
      }
    >,
    actor?: RecipeActor,
  ) {
    if (!records.length) return [];

    const normalizedSite = this.normalizeSite(actor?.site);
    const createdFields = this.buildActorFields(actor, 'created');
    const updatedFields = this.buildActorFields(actor, 'updated');
    const recipeCodes = await this.allocateRecipeCodes(records.length);
    const payload = records.map((record, index) => ({
      recipeCode: recipeCodes[index],
      name: record.name.trim(),
      version: 1,
      versionGroupId: recipeCodes[index],
      category: record.category.trim(),
      description: record.description?.trim(),
      imageUrl: record.imageUrl?.trim(),
      price: record.price ?? 0,
      portionSize: record.portionSize ?? 1,
      foodCostRecipe: this.normalizeOptionalNumber(record.foodCostRecipe),
      status: record.status ?? 'draft',
      approvalStatus: 'pending',
      ingredients: record.ingredients ?? [],
      ...createdFields,
      ...updatedFields,
      ...(normalizedSite ? { site: normalizedSite } : {}),
    }));

    return this.recipeModel.insertMany(payload, { ordered: false });
  }

  async importFromExcel(
    filePath: string,
    actor?: RecipeActor,
  ): Promise<RecipeImportResult> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('Sheet tidak ditemukan.');

    const parseResult = await this.parseImportWorksheet(worksheet);
    if (!parseResult.records.length) {
      return {
        insertedCount: 0,
        ingredientsCount: 0,
        warningsCount: parseResult.warnings.length,
        warnings: parseResult.warnings.slice(0, DEFAULT_WARNING_LIMIT),
        fallbackRows: parseResult.fallbackRows,
      };
    }

    const created = await this.bulkCreate(parseResult.records, actor);
    return {
      insertedCount: created.length,
      ingredientsCount: parseResult.ingredientsCount,
      warningsCount: parseResult.warnings.length,
      warnings: parseResult.warnings.slice(0, DEFAULT_WARNING_LIMIT),
      fallbackRows: parseResult.fallbackRows,
    };
  }

  private async parseImportWorksheet(
    worksheet: Worksheet,
  ): Promise<RecipeImportParseResult> {
    const blockStarts = this.findRecipeCardBlockStarts(worksheet);
    if (blockStarts.length > 0) {
      return this.parseRecipeCardWorksheet(worksheet, blockStarts);
    }
    return this.parseLegacyWorksheet(worksheet);
  }

  private async parseRecipeCardWorksheet(
    worksheet: Worksheet,
    blockStarts: number[],
  ): Promise<RecipeImportParseResult> {
    const records: ImportRecipeRecord[] = [];
    const warnings: RecipeImportWarning[] = [];
    const fallbackRows = this.createFallbackRowsCounter();
    let ingredientsCount = 0;

    const blocks: RecipeCardBlock[] = blockStarts.map((startRow, index) => ({
      index,
      startRow,
      endRow:
        index < blockStarts.length - 1
          ? blockStarts[index + 1] - 1
          : worksheet.rowCount,
    }));

    const rawMaterialCache = new Map<string, RawMaterialLookup | null>();

    for (const block of blocks) {
      const header = this.findRecipeCardHeaderMap(
        worksheet,
        block.startRow,
        block.endRow,
      );
      if (!header) {
        warnings.push({
          code: 'missing_header',
          row: block.startRow,
          message: `Recipe card block ${block.index + 1} skipped because QTY/PRODUCT CODE header was not found.`,
        });
        continue;
      }

      const meta = this.extractRecipeCardMeta(worksheet, block, warnings);
      const ingredients: RecipeIngredient[] = [];
      const summaryCost = this.extractSummaryCost(worksheet, block, header);

      // Complex parser: reads one card block and applies row-level fallback rules.
      for (
        let rowNumber = header.headerRow + 1;
        rowNumber <= block.endRow;
        rowNumber += 1
      ) {
        const rowValues = this.readRowCells(worksheet, rowNumber, 20);
        if (this.shouldStopRecipeCardIngredientRows(rowValues)) {
          break;
        }

        const qtyRaw = this.cellToNumber(rowValues[header.qtyCol] ?? null);
        const qty =
          qtyRaw !== undefined && Number.isFinite(qtyRaw) && qtyRaw > 0
            ? qtyRaw
            : undefined;

        const productCodeRaw = this.cellToText(
          rowValues[header.productCodeCol] ?? null,
        );
        const ingredientText = header.ingredientCol
          ? this.cellToText(rowValues[header.ingredientCol] ?? null)
          : '';
        const productDescription = header.productDescriptionCol
          ? this.cellToText(rowValues[header.productDescriptionCol] ?? null)
          : '';
        const name = productDescription || ingredientText;
        if (!productCodeRaw) {
          fallbackRows.missingProductCode += 1;
          warnings.push({
            code: 'missing_product_code',
            row: rowNumber,
            recipeName: meta.recipeName,
            message:
              'Product code kosong. Data tetap diimport dengan productCode kosong.',
          });
        }

        const priceUom = header.priceUomCol
          ? this.cellToNumber(rowValues[header.priceUomCol] ?? null)
          : undefined;
        const foodCost = header.foodCostCol
          ? this.cellToNumber(rowValues[header.foodCostCol] ?? null)
          : undefined;

        const hasAnyIngredientData =
          qty !== undefined ||
          !!productCodeRaw ||
          !!name ||
          priceUom !== undefined ||
          foodCost !== undefined;
        if (!hasAnyIngredientData) {
          continue;
        }

        if (!name) {
          warnings.push({
            code: 'missing_name',
            row: rowNumber,
            recipeName: meta.recipeName,
            message:
              'Nama ingredient kosong. Data tetap diimport dengan name kosong.',
          });
        }

        const finalQty = qty;
        let finalUnit = '';
        let resolvedRawMaterial: RawMaterialLookup | null = null;

        if (productCodeRaw) {
          resolvedRawMaterial = await this.resolveRawMaterial(
            productCodeRaw,
            rawMaterialCache,
          );
        }

        if (resolvedRawMaterial) {
          // Import policy update:
          // - qty is used as-is from file (no unit conversion)
          // - unit follows raw material master data
          finalUnit = resolvedRawMaterial.unitOfMeasures.trim();
        } else if (productCodeRaw) {
          fallbackRows.rawMaterialNotFound += 1;
          warnings.push({
            code: 'raw_material_not_found',
            row: rowNumber,
            recipeName: meta.recipeName,
            message: `Raw material not found for product code ${productCodeRaw}.`,
          });
        }

        const ingredient: RecipeIngredient = {
          productCode: productCodeRaw.trim(),
          name: name.trim(),
          unitOfMeasures: finalUnit,
          ...(finalQty !== undefined ? { qty: finalQty } : {}),
          ...(priceUom !== undefined ? { priceUom } : {}),
          ...(foodCost !== undefined ? { foodCost } : {}),
        };

        ingredients.push(ingredient);
      }

      const ingredientFoodCostSum = ingredients.reduce((sum, item) => {
        return sum + (item.foodCost ?? 0);
      }, 0);
      const foodCostRecipe =
        summaryCost.totalCost ??
        summaryCost.subTotalCost ??
        (ingredientFoodCostSum > 0 ? ingredientFoodCostSum : undefined);

      records.push({
        name: meta.recipeName,
        category: meta.category,
        portionSize: meta.portionSize,
        status: 'draft',
        ingredients,
        price: 0,
        ...(foodCostRecipe !== undefined ? { foodCostRecipe } : {}),
      });
      ingredientsCount += ingredients.length;
    }

    return { records, warnings, fallbackRows, ingredientsCount };
  }

  private parseLegacyWorksheet(worksheet: Worksheet): RecipeImportParseResult {
    const warnings: RecipeImportWarning[] = [];
    const fallbackRows = this.createFallbackRowsCounter();
    const records: ImportRecipeRecord[] = [];

    const headerValues = this.readRowCells(worksheet, 1, 20);
    const headerMap = this.buildLegacyHeaderMap(headerValues);
    if (!headerMap.name) {
      throw new BadRequestException(
        'Header harus berisi name untuk import recipe.',
      );
    }

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const values = this.readRowCells(worksheet, rowNumber, 20);
      const name = this.cellToText(values[headerMap.name] ?? null);
      const category = headerMap.category
        ? this.cellToText(values[headerMap.category] ?? null)
        : '';
      if (!name) {
        if (category) {
          warnings.push({
            code: 'legacy_row_skipped',
            row: rowNumber,
            message: 'Legacy row skipped because name is empty.',
          });
        }
        continue;
      }

      const description = headerMap.description
        ? this.cellToText(values[headerMap.description] ?? null)
        : '';
      const price = headerMap.price
        ? this.cellToNumber(values[headerMap.price] ?? null)
        : undefined;
      const portionSize = headerMap.portionSize
        ? this.cellToNumber(values[headerMap.portionSize] ?? null)
        : undefined;
      const statusRaw = headerMap.status
        ? this.cellToText(values[headerMap.status] ?? null)
        : '';
      const foodCostRecipe = headerMap.foodCostRecipe
        ? this.cellToNumber(values[headerMap.foodCostRecipe] ?? null)
        : undefined;

      records.push({
        name,
        category,
        description: description || undefined,
        price: price !== undefined && price >= 0 ? price : 0,
        portionSize:
          portionSize !== undefined && portionSize >= 1 ? portionSize : 1,
        status: this.normalizeStatus(statusRaw),
        ingredients: [],
        ...(foodCostRecipe !== undefined ? { foodCostRecipe } : {}),
      });
    }

    return {
      records,
      warnings,
      fallbackRows,
      ingredientsCount: 0,
    };
  }

  private findRecipeCardBlockStarts(worksheet: Worksheet): number[] {
    const starts: number[] = [];
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const rowValues = this.readRowCells(worksheet, rowNumber, 3);
      const firstCell = this.normalizeLabel(
        this.cellToText(rowValues[1] ?? null),
      );
      if (firstCell.includes('recipe card')) {
        starts.push(rowNumber);
      }
    }
    return starts;
  }

  private findRecipeCardHeaderMap(
    worksheet: Worksheet,
    startRow: number,
    endRow: number,
  ): RecipeCardHeaderMap | undefined {
    const maxRow = Math.min(endRow, startRow + 80);
    for (let rowNumber = startRow; rowNumber <= maxRow; rowNumber += 1) {
      const rowValues = this.readRowCells(worksheet, rowNumber, 20);
      const normalizedCells: Array<{ col: number; value: string }> = [];
      for (let col = 1; col < rowValues.length; col += 1) {
        const normalized = this.normalizeLabel(
          this.cellToText(rowValues[col] ?? null),
        );
        if (normalized) normalizedCells.push({ col, value: normalized });
      }

      const qtyCol = this.findColumnForHeader(normalizedCells, ['qty']);
      const productCodeCol = this.findColumnForHeader(normalizedCells, [
        'product code',
        'product code/item',
        'productcode',
      ]);
      if (!qtyCol || !productCodeCol) continue;

      const ingredientCol = this.findColumnForHeader(normalizedCells, [
        'ingredient',
      ]);
      const productDescriptionCol = this.findColumnForHeader(normalizedCells, [
        'product description',
      ]);

      if (!ingredientCol && !productDescriptionCol) continue;

      const unitCols = normalizedCells
        .filter((item) => item.value === 'unit')
        .map((item) => item.col)
        .sort((a, b) => a - b);
      const anchorCol = Math.max(
        productCodeCol,
        ingredientCol ?? 0,
        productDescriptionCol ?? 0,
      );

      const unitLeftCol = unitCols.find((col) => col < productCodeCol);
      const unitRightCol =
        unitCols.find((col) => col > anchorCol) ??
        (unitCols.length > 1 ? unitCols[1] : undefined);

      const priceUomCol = this.findColumnForHeader(normalizedCells, [
        'price uom',
        'price/uom',
      ]);
      const foodCostCol = this.findColumnForHeader(normalizedCells, [
        'food cost recipe',
        'food cost',
      ]);

      return {
        headerRow: rowNumber,
        qtyCol,
        productCodeCol,
        ingredientCol,
        productDescriptionCol,
        unitLeftCol,
        unitRightCol,
        priceUomCol,
        foodCostCol,
      };
    }

    return undefined;
  }

  private extractRecipeCardMeta(
    worksheet: Worksheet,
    block: RecipeCardBlock,
    warnings: RecipeImportWarning[],
  ): BlockMeta {
    const recipeNameCell = this.findLabelCell(
      worksheet,
      block.startRow,
      block.endRow,
      ['recipe name'],
    );
    const recipeName =
      recipeNameCell &&
      (this.readAdjacentText(
        worksheet,
        recipeNameCell.row,
        recipeNameCell.col,
        20,
      ) ||
        this.readNearbyText(
          worksheet,
          recipeNameCell.row + 1,
          recipeNameCell.col,
          20,
        ));
    const normalizedName =
      recipeName && recipeName.trim()
        ? recipeName.trim()
        : `Imported Recipe ${block.index + 1}`;

    const categoryCell = this.findLabelCell(
      worksheet,
      block.startRow,
      block.endRow,
      ['food type'],
    );
    const rawCategory =
      (categoryCell &&
        this.readAdjacentText(
          worksheet,
          categoryCell.row,
          categoryCell.col,
          20,
        )) ||
      '';
    const normalizedCategory = this.normalizeLabel(rawCategory);
    const category =
      normalizedCategory === 'food type' ? '' : rawCategory.trim();

    const portionCell = this.findLabelCell(
      worksheet,
      block.startRow,
      block.endRow,
      ['portion'],
    );
    const portionValue =
      portionCell &&
      (this.cellToNumber(
        this.readRowCells(worksheet, portionCell.row + 1, 20)[
          portionCell.col
        ] ?? null,
      ) ??
        this.cellToNumber(
          this.readRowCells(worksheet, portionCell.row, 20)[
            portionCell.col + 1
          ] ?? null,
        ));

    const portionSize =
      portionValue !== undefined && portionValue > 0 ? portionValue : 1;
    if (portionCell && (portionValue === undefined || portionValue <= 0)) {
      warnings.push({
        code: 'invalid_portion',
        row: portionCell.row,
        recipeName: normalizedName,
        message: 'Invalid portion value. Defaulted to 1.',
      });
    }

    return {
      recipeName: normalizedName,
      category,
      portionSize,
    };
  }

  private extractSummaryCost(
    worksheet: Worksheet,
    block: RecipeCardBlock,
    header: RecipeCardHeaderMap,
  ): { totalCost?: number; subTotalCost?: number } {
    let totalCost: number | undefined;
    let subTotalCost: number | undefined;

    for (
      let rowNumber = header.headerRow + 1;
      rowNumber <= block.endRow;
      rowNumber += 1
    ) {
      const rowValues = this.readRowCells(worksheet, rowNumber, 20);
      const rowLabel = this.normalizeLabel(
        rowValues
          .slice(1, 10)
          .map((value) => this.cellToText(value ?? null))
          .join(' '),
      );

      if (rowLabel.includes('sub total cost')) {
        subTotalCost = this.findNumericInRow(rowValues, header.foodCostCol);
        continue;
      }

      if (rowLabel.includes('total cost')) {
        totalCost = this.findNumericInRow(rowValues, header.foodCostCol);
      }
    }

    return { totalCost, subTotalCost };
  }

  private shouldStopRecipeCardIngredientRows(values: CellValue[]): boolean {
    const joined = this.normalizeLabel(
      values
        .slice(1, 10)
        .map((value) => this.cellToText(value ?? null))
        .join(' '),
    );
    if (!joined) return false;

    return (
      joined.includes('recipe card') ||
      joined.includes('method') ||
      joined.includes('remarks') ||
      joined.includes('remark') ||
      joined.includes('sub total cost') ||
      joined.includes('total cost') ||
      joined.includes('food cost %')
    );
  }

  private findColumnForHeader(
    cells: Array<{ col: number; value: string }>,
    aliases: string[],
  ): number | undefined {
    for (const cell of cells) {
      if (
        aliases.some(
          (alias) => cell.value === alias || cell.value.includes(alias),
        )
      ) {
        return cell.col;
      }
    }
    return undefined;
  }

  private findLabelCell(
    worksheet: Worksheet,
    startRow: number,
    endRow: number,
    aliases: string[],
  ): LabelCell | undefined {
    const maxRow = Math.min(endRow, startRow + 40);
    for (let row = startRow; row <= maxRow; row += 1) {
      const rowValues = this.readRowCells(worksheet, row, 20);
      for (let col = 1; col < rowValues.length; col += 1) {
        const label = this.normalizeLabel(
          this.cellToText(rowValues[col] ?? null),
        );
        if (!label) continue;
        if (aliases.some((alias) => label === alias || label.includes(alias))) {
          return { row, col };
        }
      }
    }
    return undefined;
  }

  private readAdjacentText(
    worksheet: Worksheet,
    row: number,
    col: number,
    maxCol: number,
  ): string {
    const values = this.readRowCells(worksheet, row, maxCol);
    for (let idx = col + 1; idx <= maxCol; idx += 1) {
      const text = this.cellToText(values[idx] ?? null);
      if (text) return text;
    }
    return '';
  }

  private readNearbyText(
    worksheet: Worksheet,
    row: number,
    col: number,
    maxCol: number,
  ): string {
    const values = this.readRowCells(worksheet, row, maxCol);
    for (let idx = col; idx <= maxCol; idx += 1) {
      const text = this.cellToText(values[idx] ?? null);
      if (text) return text;
    }
    return '';
  }

  private buildLegacyHeaderMap(values: CellValue[]): LegacyHeaderMap {
    const map: LegacyHeaderMap = {};
    const aliasEntries = Object.entries(LEGACY_HEADER_ALIASES) as Array<
      [LegacyHeaderKey, readonly string[]]
    >;
    for (let idx = 1; idx < values.length; idx += 1) {
      const header = this.normalizeLabel(this.cellToText(values[idx] ?? null));
      if (!header) continue;
      for (const [key, aliases] of aliasEntries) {
        if (
          aliases.some((alias) => header === alias || header.includes(alias))
        ) {
          map[key] = idx;
        }
      }
    }
    return map;
  }

  private readRowCells(
    worksheet: Worksheet,
    rowNumber: number,
    maxCol: number,
  ): CellValue[] {
    const row = worksheet.getRow(rowNumber);
    const values: CellValue[] = [];
    for (let col = 1; col <= maxCol; col += 1) {
      values[col] = row.getCell(col).value;
    }
    return values;
  }

  private cellToText(value: CellValue | null): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : '';
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value instanceof Date) return value.toISOString();

    if (typeof value === 'object') {
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText
          .map((item) => (typeof item.text === 'string' ? item.text : ''))
          .join('')
          .trim();
      }
      if ('text' in value && typeof value.text === 'string') {
        return value.text.trim();
      }
      if ('result' in value) {
        const result = (value as { result?: CellValue }).result;
        return this.cellToText(result ?? null);
      }
      if ('hyperlink' in value && typeof value.hyperlink === 'string') {
        return value.hyperlink.trim();
      }
    }

    return '';
  }

  private cellToNumber(value: CellValue | null): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
      return this.parseTextNumber(value);
    }
    if (typeof value === 'object') {
      if ('result' in value) {
        const result = (value as { result?: CellValue }).result;
        return this.cellToNumber(result ?? null);
      }
      if ('text' in value && typeof value.text === 'string') {
        return this.parseTextNumber(value.text);
      }
      if ('richText' in value && Array.isArray(value.richText)) {
        const text = value.richText
          .map((item) => (typeof item.text === 'string' ? item.text : ''))
          .join('');
        return this.parseTextNumber(text);
      }
    }
    return undefined;
  }

  private parseTextNumber(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;

    const compact = trimmed.replace(/\s/g, '');
    const filtered = compact.replace(/[^0-9,.-]/g, '');
    if (!filtered) return undefined;

    const normalized =
      filtered.includes(',') && !filtered.includes('.')
        ? filtered.replace(',', '.')
        : filtered.replace(/,/g, '');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
  }

  private normalizeLabel(value: string): string {
    return value.toLowerCase().replace(/[:]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private normalizeImportedUnit(value?: string): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    const normalized = trimmed.toLowerCase().replace(/\./g, '');
    if (UOM_ALIASES[normalized]) {
      return UOM_ALIASES[normalized];
    }

    const tokenized = normalized.replace(/[^a-z0-9]+/g, ' ').trim();
    if (!tokenized) return undefined;
    const tokens = tokenized.split(/\s+/);
    for (const token of tokens) {
      if (UOM_ALIASES[token]) {
        return UOM_ALIASES[token];
      }
    }
    return tokenized;
  }

  private roundQuantity(value: number) {
    if (!Number.isFinite(value)) return undefined;
    return Number(value.toFixed(QUANTITY_DECIMAL_PLACES));
  }

  private convertQty(
    qty: number,
    from?: string,
    to?: string,
  ): number | undefined {
    if (!Number.isFinite(qty)) return undefined;
    if (!from || !to) return undefined;
    if (from === to) return qty;

    if (from === 'gram' && to === 'kg') return this.roundQuantity(qty / 1000);
    if (from === 'kg' && to === 'gram') return this.roundQuantity(qty * 1000);
    if (from === 'ml' && to === 'liter') return this.roundQuantity(qty / 1000);
    if (from === 'liter' && to === 'ml') return this.roundQuantity(qty * 1000);

    return undefined;
  }

  private async resolveRawMaterial(
    productCode: string,
    cache: Map<string, RawMaterialLookup | null>,
  ): Promise<RawMaterialLookup | null> {
    const normalized = productCode.trim().toLowerCase();
    if (!normalized) return null;
    if (cache.has(normalized)) return cache.get(normalized) ?? null;

    const item = await this.rawMaterials.findLookupByNormalizedCode(normalized);
    cache.set(normalized, item ?? null);
    return item ?? null;
  }

  private findNumericInRow(
    values: CellValue[],
    preferredColumn?: number,
  ): number | undefined {
    if (preferredColumn) {
      const preferred = this.cellToNumber(values[preferredColumn] ?? null);
      if (preferred !== undefined) return preferred;
    }

    for (let col = values.length - 1; col >= 1; col -= 1) {
      const parsed = this.cellToNumber(values[col] ?? null);
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  }

  private createFallbackRowsCounter(): RecipeImportFallbackRows {
    return {
      missingProductCode: 0,
      missingUom: 0,
      rawMaterialNotFound: 0,
      conversionNotPossible: 0,
    };
  }

  private normalizeIngredients(
    input?: Array<{
      productCode: string;
      ingredientType?: 'IT' | 'NMP';
      name: string;
      unitOfMeasures: string;
      qty: number;
      prodQty?: number;
      prodUomCode?: string;
      srQty?: number;
      srQtyManual?: boolean;
      srUomCode?: string;
      conversionId?: string;
      conversionMultiplier?: number;
      priceUom?: number;
      foodCost?: number;
    }>,
  ): RecipeIngredient[] {
    return (input ?? []).map((item) => {
      const priceUom = this.normalizeOptionalNumber(item.priceUom);
      const foodCost = this.normalizeOptionalNumber(item.foodCost);
      const prodQty = this.normalizeOptionalNumber(item.prodQty);
      const srQty = this.normalizeOptionalNumber(item.srQty);
      const conversionMultiplier = this.normalizeOptionalNumber(
        item.conversionMultiplier,
      );
      const prodUomCode = item.prodUomCode?.trim();
      const srUomCode = item.srUomCode?.trim();
      const conversionId = item.conversionId?.trim();
      return {
        ...(item.ingredientType ? { ingredientType: item.ingredientType } : {}),
        productCode:
          item.ingredientType === 'NMP' ? 'NMP' : item.productCode.trim(),
        name: item.name.trim(),
        unitOfMeasures: item.unitOfMeasures.trim(),
        qty: item.qty,
        ...(prodQty !== undefined ? { prodQty } : {}),
        ...(prodUomCode ? { prodUomCode } : {}),
        ...(srQty !== undefined ? { srQty } : {}),
        ...(item.srQtyManual ? { srQtyManual: true } : {}),
        ...(srUomCode ? { srUomCode } : {}),
        ...(conversionId ? { conversionId } : {}),
        ...(conversionMultiplier !== undefined ? { conversionMultiplier } : {}),
        ...(priceUom !== undefined ? { priceUom } : {}),
        ...(foodCost !== undefined ? { foodCost } : {}),
      };
    });
  }

  private async applyIngredientUomConversions(
    ingredients: RecipeIngredient[],
  ): Promise<RecipeIngredient[]> {
    const nextIngredients: RecipeIngredient[] = [];
    const rawMaterialCache = new Map<string, RawMaterialLookup | null>();

    for (const ingredient of ingredients) {
      const prodQty = this.normalizeOptionalNumber(ingredient.prodQty);
      const prodUomCode = ingredient.prodUomCode?.trim();
      const srUomCode =
        ingredient.srUomCode?.trim() || ingredient.unitOfMeasures?.trim();

      if (prodQty === undefined || !prodUomCode || !srUomCode) {
        nextIngredients.push(ingredient);
        continue;
      }

      const normalizedProdUomCode = this.normalizeUomCode(prodUomCode);
      const normalizedSrUomCode = this.normalizeUomCode(srUomCode);
      if (ingredient.srQtyManual) {
        const manualSrQty = this.normalizeOptionalNumber(ingredient.srQty);
        if (manualSrQty === undefined || manualSrQty <= 0) {
          throw new BadRequestException(
            `SR quantity for ${ingredient.name || ingredient.productCode || 'ingredient'} must be greater than 0.`,
          );
        }
        nextIngredients.push({
          ...ingredient,
          unitOfMeasures: normalizedSrUomCode,
          qty: manualSrQty,
          prodQty,
          prodUomCode: normalizedProdUomCode,
          srQty: manualSrQty,
          srQtyManual: true,
          srUomCode: normalizedSrUomCode,
          conversionId: undefined,
          conversionMultiplier: undefined,
        });
        continue;
      }
      if (
        normalizedProdUomCode &&
        normalizedProdUomCode === normalizedSrUomCode
      ) {
        nextIngredients.push({
          ...ingredient,
          unitOfMeasures: normalizedSrUomCode,
          qty: prodQty,
          prodQty,
          prodUomCode: normalizedProdUomCode,
          srQty: prodQty,
          srUomCode: normalizedSrUomCode,
          conversionId: `${normalizedProdUomCode} To ${normalizedSrUomCode}`,
          conversionMultiplier: 1,
        });
        continue;
      }

      const rawMaterial =
        ingredient.ingredientType === 'NMP'
          ? null
          : await this.resolveRawMaterial(
              ingredient.productCode?.trim() ?? '',
              rawMaterialCache,
            );
      const specificIngredient = this.applySpecificIngredientConversion(
        ingredient,
        rawMaterial,
        prodQty,
        prodUomCode,
        srUomCode,
      );
      if (specificIngredient) {
        nextIngredients.push(specificIngredient);
        continue;
      }

      const conversion = await this.unitOfMeasures.findActiveConversion(
        prodUomCode,
        srUomCode,
      );

      if (!conversion) {
        throw new BadRequestException(
          `Conversion ${prodUomCode} To ${srUomCode} is not configured.`,
        );
      }

      const srQty = this.roundQuantity(prodQty * conversion.multiplier);
      nextIngredients.push({
        ...ingredient,
        unitOfMeasures: srUomCode,
        qty: srQty,
        prodQty,
        prodUomCode: conversion.prodUomCode,
        srQty,
        srUomCode: conversion.srUomCode,
        conversionId: conversion.conversionId,
        conversionMultiplier: conversion.multiplier,
      });
    }

    return nextIngredients;
  }

  private applySpecificIngredientConversion(
    ingredient: RecipeIngredient,
    rawMaterial: RawMaterialLookup | null,
    prodQty: number,
    prodUomCode: string,
    srUomCode: string,
  ): RecipeIngredient | null {
    if (!rawMaterial) return null;

    const prod = this.normalizeUomCode(prodUomCode);
    const sr = this.normalizeUomCode(srUomCode);
    const matchingRule = rawMaterial.specificConversions?.find(
      (rule) =>
        this.normalizeUomCode(rule.prodUomCode) === prod &&
        this.normalizeUomCode(rule.srUomCode) === sr,
    );
    const rawMaterialSr = this.normalizeUomCode(rawMaterial.unitOfMeasures);
    const rawMaterialBase = this.normalizeUomCode(
      rawMaterial.baseUnitOfMeasures,
    );
    const legacyMatches = rawMaterialBase === prod && rawMaterialSr === sr;
    const conversionFactor = this.normalizeOptionalNumber(
      matchingRule?.conversionFactor ??
        (legacyMatches ? rawMaterial.conversionFactor : undefined),
    );

    if (
      !prod ||
      !sr ||
      conversionFactor === undefined ||
      conversionFactor <= 0
    ) {
      return null;
    }

    const multiplier = 1 / conversionFactor;
    const srQty = this.roundQuantity(prodQty * multiplier);
    return {
      ...ingredient,
      unitOfMeasures: sr,
      qty: srQty,
      prodQty,
      prodUomCode: prod,
      srQty,
      srUomCode: sr,
      conversionId: `${prod} To ${sr}`,
      conversionMultiplier: multiplier,
    };
  }

  private async buildIngredientCostUpdate(ingredients: RecipeIngredient[]) {
    const rawMaterialLookups =
      await this.rawMaterials.findLookupsByNormalizedCodes(
        ingredients
          .map((ingredient) => ingredient.productCode?.trim() ?? '')
          .filter(Boolean),
      );
    const rawMaterialByCode = new Map(
      rawMaterialLookups.map((item) => [item.productCodeNormalized, item]),
    );
    const nextIngredients = ingredients.map((ingredient) => {
      const result = this.applyIngredientCostFromLookup(
        ingredient,
        rawMaterialByCode,
      );
      return 'ingredient' in result ? result.ingredient : ingredient;
    });
    const foodCostRecipe = this.calculateFoodCostRecipe(nextIngredients);

    return {
      ingredients: nextIngredients,
      ...(foodCostRecipe > 0
        ? { foodCostRecipe: this.roundQuantity(foodCostRecipe) }
        : {}),
    };
  }

  private applyIngredientCostFromLookup(
    ingredient: RecipeIngredient,
    rawMaterialByCode: Map<string, RawMaterialLookup>,
  ):
    | {
        status: 'matched';
        changed: boolean;
        ingredient: RecipeIngredient;
      }
    | { status: 'missing_raw_material' }
    | { status: 'missing_price' } {
    const productCode = ingredient.productCode?.trim() ?? '';
    if (!productCode) return { status: 'missing_raw_material' };

    const rawMaterial = rawMaterialByCode.get(productCode.toLowerCase());
    if (!rawMaterial) return { status: 'missing_raw_material' };

    const unitPrice = this.normalizeOptionalNumber(rawMaterial.price);
    if (unitPrice === undefined) return { status: 'missing_price' };

    const qty = Number(ingredient.qty);
    const foodCost = Number.isFinite(qty)
      ? this.roundQuantity(qty * unitPrice)
      : undefined;
    const currentPrice = this.normalizeOptionalNumber(ingredient.priceUom);
    const currentFoodCost = this.normalizeOptionalNumber(ingredient.foodCost);
    const nextIngredient: RecipeIngredient = {
      ...ingredient,
      priceUom: unitPrice,
      ...(foodCost !== undefined ? { foodCost } : {}),
    };

    return {
      status: 'matched',
      changed: currentPrice !== unitPrice || currentFoodCost !== foodCost,
      ingredient: nextIngredient,
    };
  }

  private calculateFoodCostRecipe(ingredients: RecipeIngredient[]) {
    return ingredients.reduce((sum, ingredient) => {
      const foodCost = this.normalizeOptionalNumber(ingredient.foodCost);
      return sum + (foodCost ?? 0);
    }, 0);
  }

  private normalizeOptionalNumber(value?: number): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private normalizeUomCode(value?: string): string {
    return value?.trim().toUpperCase() ?? '';
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseCsv(value?: string): string[] {
    if (!value?.trim()) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private formatRecipeCode(sequence: number): string {
    const safeNumber = Number.isFinite(sequence) && sequence > 0 ? sequence : 1;
    return `${RECIPE_CODE_PREFIX}${String(Math.floor(safeNumber)).padStart(
      RECIPE_CODE_MIN_DIGITS,
      '0',
    )}`;
  }

  private async reserveRecipeCodeRange(count: number): Promise<{
    start: number;
    end: number;
  }> {
    if (!Number.isInteger(count) || count < 1) {
      throw new BadRequestException('Recipe code range count must be >= 1.');
    }

    const counter = await this.recipeCodeCounterModel.findOneAndUpdate(
      { key: RECIPE_CODE_COUNTER_KEY },
      {
        $inc: { seq: count },
        $setOnInsert: { key: RECIPE_CODE_COUNTER_KEY },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    if (!counter) {
      throw new BadRequestException('Failed to reserve recipe code range.');
    }

    const end = Number(counter.seq);
    const start = end - count + 1;
    return { start, end };
  }

  private async allocateRecipeCodes(count: number): Promise<string[]> {
    if (!count) return [];
    const { start } = await this.reserveRecipeCodeRange(count);
    return Array.from({ length: count }, (_, index) =>
      this.formatRecipeCode(start + index),
    );
  }

  private async nextRecipeCode(): Promise<string> {
    const codes = await this.allocateRecipeCodes(1);
    return codes[0];
  }

  private async resolveRecipeVersionMetadata(
    input: CreateRecipeDto,
    recipeCode: string,
  ): Promise<RecipeVersionMetadata> {
    const baseRecipeId = input.baseRecipeId?.trim();
    if (!baseRecipeId) {
      return {
        name: input.name.trim(),
        version: 1,
        versionGroupId: recipeCode,
      };
    }

    const baseRecipe = await this.recipeModel
      .findOne({
        _id: baseRecipeId,
        approvalStatus: 'approved',
        deletedAt: { $exists: false },
      })
      .select({
        _id: 1,
        name: 1,
        recipeCode: 1,
        version: 1,
        versionGroupId: 1,
      })
      .lean();

    if (!baseRecipe) {
      throw new NotFoundException('Approved base recipe not found.');
    }

    const parentRecipeId = String(baseRecipe._id);
    const baseVersion = this.normalizeRecipeVersion(baseRecipe.version);
    const versionGroupId =
      baseRecipe.versionGroupId?.trim() ||
      baseRecipe.recipeCode?.trim() ||
      parentRecipeId;

    if (
      baseRecipe.version !== baseVersion ||
      baseRecipe.versionGroupId !== versionGroupId
    ) {
      await this.recipeModel.updateOne(
        { _id: baseRecipe._id },
        {
          $set: {
            version: baseVersion,
            versionGroupId,
          },
        },
      );
    }

    const latestRecipe = await this.recipeModel
      .findOne({
        versionGroupId,
      })
      .select({ version: 1 })
      .sort({ version: -1 })
      .lean();
    const latestVersion = Math.max(
      baseVersion,
      this.normalizeRecipeVersion(latestRecipe?.version),
    );

    return {
      name: baseRecipe.name.trim(),
      version: latestVersion + 1,
      versionGroupId,
      parentRecipeId,
    };
  }

  private normalizeRecipeVersion(value?: number): number {
    const version = Number(value);
    return Number.isInteger(version) && version >= 1 ? version : 1;
  }

  private async backfillMissingRecipeCodes(): Promise<void> {
    const missingRecipes = await this.recipeModel
      .find({
        deletedAt: { $exists: false },
        $or: [
          { recipeCode: { $exists: false } },
          { recipeCode: '' },
          { recipeCode: null },
        ],
      })
      .select({ _id: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    if (missingRecipes.length === 0) return;

    const codes = await this.allocateRecipeCodes(missingRecipes.length);
    await this.recipeModel.bulkWrite(
      missingRecipes.map((item, index) => ({
        updateOne: {
          filter: {
            _id: item._id,
            $or: [
              { recipeCode: { $exists: false } },
              { recipeCode: '' },
              { recipeCode: null },
            ],
          },
          update: { $set: { recipeCode: codes[index] } },
        },
      })),
      { ordered: false },
    );
  }

  private normalizeStatus(value: string): 'active' | 'draft' {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'active' || normalized === 'aktif') return 'active';
    return 'draft';
  }

  // BACKEND LOGIC: category list for frontend filters.
  async listCategories(site?: string): Promise<string[]> {
    const visibilityFilter = this.buildVisibilityFilter(site);
    const filter = Object.keys(visibilityFilter).length
      ? {
          $and: [
            { category: { $ne: '' } },
            { deletedAt: { $exists: false } },
            visibilityFilter,
          ],
        }
      : { category: { $ne: '' }, deletedAt: { $exists: false } };
    const categories = await this.recipeModel.distinct('category', filter);
    return (categories ?? [])
      .map((item) => String(item).trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  private buildActorFields(
    actor: RecipeActor | undefined,
    prefix: 'created' | 'updated' | 'reviewed',
  ): Record<string, string> {
    if (!actor) return {};
    const fields: Record<string, string> = {};
    if (actor.id) fields[`${prefix}By`] = actor.id;
    if (actor.name) fields[`${prefix}ByName`] = actor.name.trim();
    if (actor.email)
      fields[`${prefix}ByEmail`] = actor.email.trim().toLowerCase();
    return fields;
  }

  private isSuperadminActor(actor?: RecipeActor) {
    return actor?.roles?.includes(AppRole.Superadmin) ?? false;
  }

  private isCorporateChefActor(actor?: RecipeActor) {
    return actor?.roles?.includes(AppRole.CorporateChef) ?? false;
  }

  private getActorSiteScope(
    actor?: RecipeActor,
  ): string | string[] | undefined {
    if (!this.isCorporateChefActor(actor)) return actor?.site;
    const assignedSites = Array.from(
      new Set(
        [actor?.site, ...(actor?.sites ?? [])].filter((site): site is string =>
          Boolean(site),
        ),
      ),
    );
    return assignedSites.length ? assignedSites : undefined;
  }

  private async attachActorNames(items: RecipeAuditFields[]): Promise<void> {
    const ids = new Set<string>();
    items.forEach((item) => {
      const createdBy = item.createdBy;
      const updatedBy = item.updatedBy;
      if (typeof createdBy === 'string' && createdBy) {
        ids.add(createdBy);
      }
      if (typeof updatedBy === 'string' && updatedBy) {
        ids.add(updatedBy);
      }
      if (typeof item.reviewedBy === 'string' && item.reviewedBy) {
        ids.add(item.reviewedBy);
      }
    });

    if (ids.size === 0) return;

    const nameMap = await this.users.findNamesByIds(Array.from(ids));
    if (nameMap.size === 0) return;

    items.forEach((item) => {
      if (typeof item.createdBy === 'string' && item.createdBy) {
        const name = nameMap.get(item.createdBy);
        if (name) item.createdByName = name;
      }
      if (typeof item.updatedBy === 'string' && item.updatedBy) {
        const name = nameMap.get(item.updatedBy);
        if (name) item.updatedByName = name;
      }
      if (typeof item.reviewedBy === 'string' && item.reviewedBy) {
        const name = nameMap.get(item.reviewedBy);
        if (name) item.reviewedByName = name;
      }
    });
  }

  private async attachSiteNames(
    items: Array<{ site?: string; siteName?: string }>,
  ): Promise<void> {
    const siteCodes = Array.from(
      new Set(
        items
          .map((item) => this.normalizeSite(item.site))
          .filter((site): site is string => Boolean(site)),
      ),
    );
    if (siteCodes.length === 0) return;

    const siteByCode = await this.sites.findSummariesByCodes(siteCodes);
    items.forEach((item) => {
      const siteCode = this.normalizeSite(item.site);
      if (!siteCode) return;
      item.siteName = siteByCode.get(siteCode)?.name ?? siteCode;
    });
  }

  private normalizeSite(site?: string): string | undefined {
    const trimmed = site?.trim();
    return trimmed ? trimmed : undefined;
  }

  private buildSiteFilter(site?: string | string[]) {
    if (Array.isArray(site)) {
      const sites = site
        .map((item) => this.normalizeSite(item))
        .filter(Boolean);
      return sites.length ? { site: { $in: sites } } : {};
    }
    const normalizedSite = this.normalizeSite(site);
    if (!normalizedSite) return {};
    return { site: normalizedSite };
  }

  private buildVisibilityFilter(
    site?: string,
    approvalStatus?: ApprovalStatus,
  ) {
    const siteFilter = this.buildSiteFilter(site);
    if (!Object.keys(siteFilter).length) return {};
    if (approvalStatus === 'approved') return {};
    if (approvalStatus === 'pending' || approvalStatus === 'rejected') {
      return siteFilter;
    }
    return {
      $or: [{ approvalStatus: 'approved' }, siteFilter],
    };
  }

  private withSiteFilter(
    filter: Record<string, unknown>,
    site?: string | string[],
  ) {
    const siteFilter = this.buildSiteFilter(site);
    if (!Object.keys(siteFilter).length) return filter;
    if ('$or' in siteFilter) {
      return { $and: [filter, siteFilter] };
    }
    return { ...filter, ...siteFilter };
  }

  async setImageUrl(id: string, imageUrl: string, actor?: RecipeActor) {
    const updatedFields = this.buildActorFields(actor, 'updated');
    const updatePayload = {
      imageUrl: imageUrl.trim(),
      ...updatedFields,
    };
    const updated = await this.recipeModel
      .findOneAndUpdate(
        this.withSiteFilter({ _id: id }, actor?.site),
        updatePayload,
        {
          new: true,
        },
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
        this.withSiteFilter({ _id: id }, actor?.site),
        updatePayload,
        {
          new: true,
        },
      )
      .lean();

    if (!updated) throw new NotFoundException('Recipe not found');
    return updated;
  }
}
