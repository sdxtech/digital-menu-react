import {
  BadRequestException,
  Injectable,
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

const QUANTITY_DECIMAL_PLACES = 6;

type RecipeActor = {
  id?: string;
  name?: string;
  email?: string;
  site?: string;
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
const DEFAULT_SITE = 'A1';

@Injectable()
export class RecipesService {
  constructor(
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    @InjectModel(RecipeCodeCounter.name)
    private readonly recipeCodeCounterModel: Model<RecipeCodeCounterDocument>,
    private readonly rawMaterials: RawMaterialsService,
    private readonly users: UsersService,
    private readonly sites: SitesService,
  ) {}

  async create(input: CreateRecipeDto, actor?: RecipeActor) {
    const ingredients = this.normalizeIngredients(input.ingredients);
    const imageUrl = input.imageUrl?.trim();
    const recipeCode = await this.nextRecipeCode();

    const normalizedSite = this.normalizeSite(actor?.site);
    const createdFields = this.buildActorFields(actor, 'created');
    const updatedFields = this.buildActorFields(actor, 'updated');
    const isSuperadminActor = this.isSuperadminActor(actor);
    const reviewedFields = isSuperadminActor
      ? this.buildActorFields(actor, 'reviewed')
      : {};

    return this.recipeModel.create({
      recipeCode,
      name: input.name.trim(),
      category: input.category.trim(),
      description: input.description?.trim(),
      imageUrl: imageUrl || undefined,
      price: input.price ?? 0,
      portionSize: input.portionSize ?? 1,
      foodCostRecipe: this.normalizeOptionalNumber(input.foodCostRecipe),
      status: isSuperadminActor ? 'active' : (input.status ?? 'draft'),
      approvalStatus: isSuperadminActor ? 'approved' : 'pending',
      ...(isSuperadminActor ? { reviewedAt: new Date() } : {}),
      ingredients,
      ...createdFields,
      ...updatedFields,
      ...reviewedFields,
      ...(normalizedSite ? { site: normalizedSite } : {}),
    });
  }

  async findAll(query: ListRecipesQueryDto, site?: string) {
    const filter: Record<string, unknown> = {
      deletedAt: { $exists: false },
    };
    const andFilters: Record<string, unknown>[] = [];
    const visibilityFilter = this.buildVisibilityFilter(
      site,
      query.approvalStatus,
    );
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
        ...(this.isSuperadminActor(actor)
          ? {}
          : { approvalStatus: 'pending' }),
      },
      actor?.site,
    );
    const updatedFields = this.buildActorFields(actor, 'updated');
    const reviewedFields = this.buildActorFields(actor, 'reviewed');
    const updatePayload: Record<string, unknown> = {
      $set: {
        approvalStatus: status,
        status: nextStatus,
        reviewedAt: new Date(),
        ...updatedFields,
        ...reviewedFields,
        ...(status === 'rejected' ? { rejectionReason: reason } : {}),
      },
    };
    if (status === 'approved') {
      updatePayload.$unset = { rejectionReason: '' };
    }
    const updated = await this.recipeModel
      .findOneAndUpdate(filter, updatePayload, { new: true })
      .lean();
    if (!updated) throw new NotFoundException('Recipe not found');
    return updated;
  }

  async resubmitRejectedRecipe(id: string, actor?: RecipeActor) {
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
    const updated = await this.recipeModel
      .findOneAndUpdate(
        this.withSiteFilter(
          { _id: id, approvalStatus: 'rejected' },
          actor?.site,
        ),
        {
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
        },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Recipe not found');
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

    if (input.foodCostRecipe !== undefined) {
      $set.foodCostRecipe = input.foodCostRecipe;
    }

    if (input.ingredients !== undefined) {
      $set.ingredients = this.normalizeIngredients(input.ingredients);
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      throw new BadRequestException('No fields to update.');
    }

    const updatedFields = this.buildActorFields(actor, 'updated');
    const updatePayload: Record<string, unknown> = {
      $set: {
        ...$set,
        ...updatedFields,
      },
    };

    if (Object.keys($unset).length) {
      updatePayload.$unset = $unset;
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
      name: string;
      unitOfMeasures: string;
      qty: number;
      priceUom?: number;
      foodCost?: number;
    }>,
  ): RecipeIngredient[] {
    return (input ?? []).map((item) => {
      const priceUom = this.normalizeOptionalNumber(item.priceUom);
      const foodCost = this.normalizeOptionalNumber(item.foodCost);
      return {
        productCode: item.productCode.trim(),
        name: item.name.trim(),
        unitOfMeasures: item.unitOfMeasures.trim(),
        qty: item.qty,
        ...(priceUom !== undefined ? { priceUom } : {}),
        ...(foodCost !== undefined ? { foodCost } : {}),
      };
    });
  }

  private normalizeOptionalNumber(value?: number): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
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

  private buildSiteFilter(site?: string) {
    const normalizedSite = this.normalizeSite(site);
    if (!normalizedSite) return {};
    if (normalizedSite === DEFAULT_SITE) {
      return {
        $or: [
          { site: DEFAULT_SITE },
          { site: { $exists: false } },
          { site: '' },
        ],
      };
    }
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

  private withSiteFilter(filter: Record<string, unknown>, site?: string) {
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
