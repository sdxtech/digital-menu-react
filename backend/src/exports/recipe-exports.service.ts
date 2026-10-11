import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import ExcelJS, { type CellValue, type Worksheet } from 'exceljs';
import { createReadStream, createWriteStream, type Dirent } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { Recipe, type RecipeDocument } from '../recipes/schemas/recipe.schema';
import { UsersService } from '../users/users.service';

export type RecipeExportScope = {
  site?: string | string[];
  includeInactive: boolean;
  strictSite: boolean;
};

export type RecipeExportJob = {
  userId: string;
  ids?: string[];
  excludedIds?: string[];
  requestedAt: string;
  total: number;
  scope?: RecipeExportScope;
};

export type RecipeExportResult = {
  key: string;
  filename: string;
  count: number;
};

const BATCH_SIZE = 100;
const MAX_EXCEL_ROWS = 1048576;
const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const EXPORT_KEY_PATTERN = /^exports\/(recipes-[\da-f-]+\.xlsx)$/;
const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ExportRecipe = Pick<
  Recipe,
  | 'name'
  | 'recipeCode'
  | 'category'
  | 'portionSize'
  | 'ingredients'
  | 'createdBy'
  | 'createdByName'
  | 'updatedBy'
  | 'updatedByName'
> & { _id: Types.ObjectId };

@Injectable()
export class RecipeExportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecipeExportsService.name);
  private readonly exportDirectory =
    process.env.RECIPE_EXPORT_DIR ||
    join(tmpdir(), 'digital-menu-recipe-exports');
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    @InjectModel(Recipe.name)
    private readonly recipes: Model<RecipeDocument>,
    private readonly users: UsersService,
  ) {}

  onModuleInit() {
    void this.cleanupExpiredExports().catch((error: unknown) =>
      this.logger.warn(`Could not clean up recipe exports: ${String(error)}`),
    );
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredExports().catch((error: unknown) =>
        this.logger.warn(`Could not clean up recipe exports: ${String(error)}`),
      );
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  count(
    ids: string[] | undefined,
    requestedAt: string,
    excludedIds?: string[],
    scope?: RecipeExportScope,
  ) {
    return this.recipes.countDocuments(
      this.buildFilter(ids, requestedAt, excludedIds, scope),
    );
  }

  async generate(
    input: RecipeExportJob,
    onProgress: (completed: number) => Promise<void>,
  ): Promise<RecipeExportResult> {
    await mkdir(this.exportDirectory, { recursive: true, mode: 0o700 });
    const storageFilename = `recipes-${randomUUID()}.xlsx`;
    const path = join(this.exportDirectory, storageFilename);
    const output = createWriteStream(path, { mode: 0o600 });
    // Attach the rejection handler immediately, including failures before commit.
    const outputFinished = finished(output);
    void outputFinished.catch(() => undefined);
    try {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: output,
        useStyles: true,
        useSharedStrings: false,
        zip: { zlib: { level: 1 } },
      });
      const sheet = workbook.addWorksheet('Recipes', {
        views: [{ showGridLines: true }],
        pageSetup: {
          paperSize: 9,
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        },
      });
      sheet.columns = [
        { width: 17 },
        { width: 32 },
        { width: 25 },
        { width: 42 },
        { width: 16 },
        { width: 16 },
        { width: 16 },
        { width: 16 },
      ];
      let lastId: Types.ObjectId | undefined;
      sheet.addRow([]).commit();
      let rowCount = 1;
      let count = 0;
      while (true) {
        const filter = this.buildFilter(
          input.ids,
          input.requestedAt,
          input.excludedIds,
          input.scope,
        );
        if (lastId) filter.$and = [{ _id: { $gt: lastId } }];
        const batch = await this.recipes
          .find(filter)
          .select({
            name: 1,
            recipeCode: 1,
            category: 1,
            portionSize: 1,
            ingredients: 1,
            createdBy: 1,
            createdByName: 1,
            updatedBy: 1,
            updatedByName: 1,
          })
          .sort({ _id: 1 })
          .limit(BATCH_SIZE)
          .lean<ExportRecipe[]>();
        if (!batch.length) break;
        const actorIds = [
          ...new Set(
            batch.flatMap((recipe) =>
              [recipe.createdBy, recipe.updatedBy].filter((id): id is string =>
                Boolean(id),
              ),
            ),
          ),
        ];
        const names = await this.users.findNamesByIds(actorIds);
        for (const recipe of batch) {
          const requiredRows = 8 + (recipe.ingredients?.length ?? 0);
          if (rowCount + requiredRows > MAX_EXCEL_ROWS) {
            throw new BadRequestException(
              'The export exceeds the Excel single-sheet row limit. Please select fewer recipes.',
            );
          }
          this.appendRecipe(sheet, recipe, names);
          rowCount += requiredRows;
          count += 1;
        }
        lastId = batch[batch.length - 1]._id;
        await onProgress(count);
        if (output.errored) throw output.errored;
      }
      if (!count)
        throw new BadRequestException('No recipes are available to export.');
      if (input.ids && count !== input.ids.length) {
        throw new BadRequestException(
          'Some selected recipes are no longer available. Refresh the list and select them again.',
        );
      }
      await workbook.commit();
      await outputFinished;
      await onProgress(count);
      const exportDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(input.requestedAt));
      const filename =
        input.ids?.length === 1
          ? storageFilename
          : `Recipes-${exportDate}-${count}.xlsx`;
      const key = `exports/${storageFilename}`;
      return { key, filename, count };
    } catch (error) {
      output.destroy();
      await outputFinished.catch(() => undefined);
      await rm(path, { force: true });
      throw error;
    }
  }

  async downloadFile(result: RecipeExportResult) {
    const match = EXPORT_KEY_PATTERN.exec(result.key);
    if (!match) throw new NotFoundException('Recipe export file not found.');
    const path = join(this.exportDirectory, match[1]);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('Recipe export file has expired.');
      }
      throw error;
    }
    return new StreamableFile(createReadStream(path), {
      type: XLSX_CONTENT_TYPE,
      disposition: `attachment; filename="${result.filename}"`,
      length: size,
    });
  }

  private async cleanupExpiredExports() {
    let entries: Dirent[];
    try {
      entries = await readdir(this.exportDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const cutoff = Date.now() - EXPORT_RETENTION_MS;
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !EXPORT_KEY_PATTERN.test(`exports/${entry.name}`)
      ) {
        continue;
      }
      const path = join(this.exportDirectory, entry.name);
      try {
        if ((await stat(path)).mtimeMs < cutoff) await rm(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  private buildFilter(
    ids: string[] | undefined,
    requestedAt: string,
    excludedIds?: string[],
    scope?: RecipeExportScope,
  ): Record<string, unknown> {
    const siteFilter = Array.isArray(scope?.site)
      ? { site: { $in: scope.site.map((site) => site.trim()).filter(Boolean) } }
      : scope?.site?.trim()
        ? { site: scope.site.trim() }
        : undefined;
    return {
      deletedAt: { $exists: false },
      isDraft: { $ne: true },
      createdAt: { $lte: new Date(requestedAt) },
      ...(scope && !scope.includeInactive ? { isActive: { $ne: false } } : {}),
      ...(siteFilter
        ? scope?.strictSite
          ? siteFilter
          : { $or: [{ approvalStatus: 'approved' }, siteFilter] }
        : {}),
      ...(ids
        ? { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }
        : excludedIds?.length
          ? { _id: { $nin: excludedIds.map((id) => new Types.ObjectId(id)) } }
          : {}),
    };
  }

  private appendRecipe(
    sheet: Worksheet,
    recipe: ExportRecipe,
    names: Map<string, string>,
  ) {
    const addRow = (values: CellValue[]) => {
      const row = sheet.addRow(values);
      row.font = { name: 'Calibri', size: 11, color: { argb: 'FF000000' } };
      row.height = 22;
      row.alignment = { vertical: 'middle', wrapText: true };
      return row;
    };
    const createdBy =
      names.get(recipe.createdBy ?? '') || recipe.createdByName || 'Unknown';
    const updatedBy =
      names.get(recipe.updatedBy ?? '') ||
      recipe.updatedByName ||
      (!recipe.updatedBy || recipe.updatedBy === recipe.createdBy
        ? createdBy
        : 'Unknown');
    const metadata: CellValue[][] = [
      ['RECIPE', recipe.name, 'CREATED BY', createdBy],
      [
        'RECIPE ID',
        recipe.recipeCode || String(recipe._id),
        'LAST UPDATE BY',
        updatedBy,
      ],
      ['CATEGORY', recipe.category || ''],
      ['BASE PAX', recipe.portionSize],
    ];
    for (const values of metadata) {
      const row = addRow(values);
      row.getCell(1).font = { ...row.font, bold: true };
      row.getCell(3).font = { ...row.font, bold: true };
      row.height = 32;
      row.commit();
    }
    addRow([]).commit();
    const header = addRow([
      'NO',
      'TYPE',
      'PRODUCT CODE',
      'INGREDIENT NAME',
      'PROD QTY',
      'PROD UOM',
      'SR QTY',
      'SR UOM',
    ]);
    header.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FF000000' },
    };
    header.commit();
    (recipe.ingredients ?? []).forEach((ingredient, index) => {
      const row = addRow([
        index + 1,
        ingredient.ingredientType ||
          (ingredient.productCode === 'NMP' ? 'NMP' : 'IT'),
        ingredient.productCode || '',
        ingredient.name || '',
        ingredient.prodQty ?? null,
        ingredient.prodUomCode || '',
        ingredient.srQty ?? ingredient.qty ?? null,
        ingredient.srUomCode || ingredient.unitOfMeasures || '',
      ]);
      row.height = 32;
      row.getCell(5).numFmt = '0.######';
      row.getCell(7).numFmt = '0.######';
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          bottom: { style: 'hair', color: { argb: 'FFE1E6EE' } },
        };
      });
      row.commit();
    });
    addRow([]).commit();
    addRow([]).commit();
  }
}
