import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { createReadStream, promises as fs } from 'fs';
import { Inject } from '@nestjs/common';
import { IMPORTS_QUEUE } from '../../queue/queue.constants';
import { REDIS_OPTIONS } from '../../redis/redis.constants';
import { FilesService } from '../../files/files.service';
import { ProductsService } from '../../products/products.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CategoriesService } from '../../categories/categories.service';
import { RawMaterialsService } from '../../raw-materials/raw-materials.service';

type ImportJob = {
  userId: string;
  fileKey?: string;
  fileName?: string;
  contentType?: string;
  filePath?: string;
  site?: string;
  cancelRequested?: boolean;
  cancelRequestedAt?: string;
};

type ImportError = {
  row: number;
  name?: string;
  reason: string;
};

type ProductImportCsvRecord = Record<string, unknown>;

type RawMaterialHeaderMap = {
  productCode: number;
  name: number;
  unitOfMeasures: number;
  baseUnitOfMeasures: number;
  conversionFactor: number;
  site: number;
  vendor: number;
  currency: number;
  minimumQuantity: number;
  priceQuantity: number;
  price: number;
  extraFields: Record<string, number>;
};

const RAW_MATERIAL_HEADER_ALIASES = {
  productCode: [
    'product code',
    'product_code',
    'productcode',
    'code',
    'sku',
    'kode',
    'kode produk',
  ],
  name: ['name', 'nama', 'product name', 'material name'],
  unitOfMeasures: [
    'unit of measures',
    'unit of measure',
    'unit',
    'uom',
    'unit_of_measures',
    'satuan',
  ],
  baseUnitOfMeasures: [
    'base unit of measures',
    'base unit of measure',
    'base unit',
    'base uom',
    'recipe unit',
    'recipe uom',
    'inventory unit',
    'inventory uom',
    'base_unit_of_measures',
    'base_uom',
  ],
  conversionFactor: [
    'conversion factor',
    'conversion',
    'conversion_factor',
    'item conversion',
    'item_conversion',
    'isi',
    'pack size',
    'pack_size',
  ],
  site: ['site', 'location', 'lokasi', 'cabang'],
  vendor: ['vendor', 'supplier', 'supplier name', 'vendor name', 'pemasok'],
  currency: ['currency', 'curr', 'mata uang', 'mata_uang'],
  minimumQuantity: [
    'minimal quantity',
    'minimum quantity',
    'min quantity',
    'min qty',
    'minimal qty',
    'minimum qty',
    'min_qty',
    'minimum_qty',
    'minimal_qty',
  ],
  priceQuantity: [
    'quantity',
    'price quantity',
    'pricing quantity',
    'price_quantity',
  ],
  price: ['price', 'unit price', 'unit_price', 'harga', 'cost'],
};

const RAW_MATERIAL_RESERVED_HEADERS = new Set([
  ...RAW_MATERIAL_HEADER_ALIASES.productCode,
  ...RAW_MATERIAL_HEADER_ALIASES.name,
  ...RAW_MATERIAL_HEADER_ALIASES.unitOfMeasures,
  ...RAW_MATERIAL_HEADER_ALIASES.baseUnitOfMeasures,
  ...RAW_MATERIAL_HEADER_ALIASES.conversionFactor,
  ...RAW_MATERIAL_HEADER_ALIASES.site,
  ...RAW_MATERIAL_HEADER_ALIASES.vendor,
  ...RAW_MATERIAL_HEADER_ALIASES.currency,
  ...RAW_MATERIAL_HEADER_ALIASES.minimumQuantity,
  ...RAW_MATERIAL_HEADER_ALIASES.priceQuantity,
  ...RAW_MATERIAL_HEADER_ALIASES.price,
]);

const RAW_MATERIAL_IMPORT_CANCELLED_REASON =
  'Raw material import cancelled by user.';

@Injectable()
export class ImportsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportsProcessor.name);
  private worker?: Worker<ImportJob>;

  constructor(
    @Inject(REDIS_OPTIONS) private readonly redisOptions: RedisOptions,
    @Inject(IMPORTS_QUEUE) private readonly importsQueue: Queue<ImportJob>,
    private readonly files: FilesService,
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly rawMaterials: RawMaterialsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (process.env.VERCEL === '1') return;

    this.worker = new Worker<ImportJob>(
      'imports',
      async (job) => this.handle(job),
      { connection: this.redisOptions },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async handle(job: Job<ImportJob>) {
    if (job.name === 'import-raw-materials') {
      await this.handleRawMaterials(job);
      return;
    }

    const { userId, fileKey, site } = job.data;
    const errors: ImportError[] = [];
    let successCount = 0;
    let failCount = 0;
    let processed = 0;
    const categoryCache = new Map<string, string>();

    const pushError = (error: ImportError) => {
      failCount += 1;
      if (errors.length < 50) errors.push(error);
    };

    try {
      this.notifications.emitJobProgress(userId, {
        jobId: job.id,
        processed,
        successCount,
        failCount,
      });
      if (!fileKey) {
        throw new Error('File not found for product import.');
      }

      const stream = await this.files.getObjectStream(fileKey);
      const parser = parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      const rows = stream.pipe(parser) as AsyncIterable<ProductImportCsvRecord>;

      for await (const record of rows) {
        processed += 1;
        const name = this.getRecordText(record, 'name');
        const priceValue = Number(this.getRecordText(record, 'price'));
        const categoryRaw = this.getRecordText(record, 'category');
        const description = this.normalizeOptionalText(
          this.getRecordText(record, 'description'),
        );
        const imageUrl = this.normalizeOptionalText(
          this.getRecordText(record, 'imageUrl'),
        );

        if (!name) {
          pushError({ row: processed, reason: 'Name is required' });
          continue;
        }

        if (Number.isNaN(priceValue) || priceValue < 0) {
          pushError({ row: processed, name, reason: 'Price is invalid' });
          continue;
        }

        // Chosen strategy: skip duplicates (case-insensitive) to avoid overwriting existing data.
        const existing = await this.products.findByNameInsensitive(name, site);
        if (existing) {
          pushError({ row: processed, name, reason: 'Duplicate name' });
          continue;
        }

        let categoryId: string | undefined;
        if (categoryRaw) {
          const key = categoryRaw.toLowerCase();
          const cached = categoryCache.get(key);
          if (cached) {
            categoryId = cached;
          } else {
            const category = await this.categories.findOrCreateByName(
              categoryRaw,
              site,
            );
            categoryId = category.id;
            categoryCache.set(key, categoryId);
          }
        }

        try {
          await this.products.create(
            {
              name,
              price: priceValue,
              categoryId,
              description,
              imageUrl,
              isActive: true,
            },
            site,
          );
          successCount += 1;
        } catch (error) {
          this.logger.warn(`Import row failed: ${(error as Error).message}`);
          pushError({ row: processed, name, reason: 'Failed to save product' });
        }

        if (processed % 25 === 0) {
          this.notifications.emitJobProgress(userId, {
            jobId: job.id,
            processed,
            successCount,
            failCount,
          });
        }
      }

      const summary = { successCount, failCount, errors };
      await this.notifications.create(
        userId,
        'Import completed',
        `Import finished. Success: ${successCount}, failed: ${failCount}.`,
        summary,
      );
      this.notifications.emitJobDone(userId, { jobId: job.id, ...summary });
    } catch (error) {
      const reason = (error as Error).message;
      await this.notifications.create(
        userId,
        'Import failed',
        'An error occurred while processing the import file.',
        { successCount, failCount, errors, reason },
      );
      this.notifications.emitJobFailed(userId, { jobId: job.id, reason });
      throw error;
    }
  }

  private async handleRawMaterials(job: Job<ImportJob>) {
    const { userId, fileKey, fileName, contentType, filePath } = job.data;
    const errors: ImportError[] = [];
    let successCount = 0;
    let failCount = 0;
    let processed = 0;
    const importedProductCodes = new Set<string>();
    const existingProductCodes = new Set<string>();

    const pushError = (error: ImportError) => {
      failCount += 1;
      if (errors.length < 50) errors.push(error);
    };

    const flushBatch = async (
      batch: Array<{
        productCode: string;
        name: string;
        unitOfMeasures: string;
        baseUnitOfMeasures?: string;
        conversionFactor?: number;
        site?: string;
        vendor?: string;
        currency?: string;
        minimumQuantity?: number;
        priceQuantity?: number;
        price?: number;
        extraFields?: Record<string, string>;
        row: number;
      }>,
    ) => {
      if (batch.length === 0) return;
      let rowsToSave = batch;
      let newlyImportedCodes: string[] = [];
      try {
        const batchCodes = Array.from(
          new Set(
            batch.map((item) => this.normalizeProductCode(item.productCode)),
          ),
        );
        const unseenCodes = batchCodes.filter(
          (code) =>
            !importedProductCodes.has(code) && !existingProductCodes.has(code),
        );
        const foundCodes =
          await this.rawMaterials.findExistingProductCodes(unseenCodes);
        newlyImportedCodes = unseenCodes.filter(
          (code) => !foundCodes.has(code),
        );
        foundCodes.forEach((code) => existingProductCodes.add(code));
        newlyImportedCodes.forEach((code) => importedProductCodes.add(code));

        const skippedRows = batch.filter((item) =>
          existingProductCodes.has(this.normalizeProductCode(item.productCode)),
        );
        skippedRows.forEach((item) =>
          pushError({
            row: item.row,
            name: item.name,
            reason: 'Product code already exists. Use Update Prices instead.',
          }),
        );
        rowsToSave = batch.filter((item) =>
          importedProductCodes.has(this.normalizeProductCode(item.productCode)),
        );
        if (rowsToSave.length === 0) return;

        const firstNewRowByCode = new Map<string, (typeof batch)[number]>();
        for (const item of rowsToSave) {
          const code = this.normalizeProductCode(item.productCode);
          if (
            newlyImportedCodes.includes(code) &&
            !firstNewRowByCode.has(code)
          ) {
            firstNewRowByCode.set(code, item);
          }
        }
        await this.rawMaterials.bulkUpsertByProductCode(
          Array.from(firstNewRowByCode.values()).map(
            ({
              productCode,
              name,
              unitOfMeasures,
              baseUnitOfMeasures,
              conversionFactor,
              site,
              vendor,
              currency,
              minimumQuantity,
              priceQuantity,
              price,
              extraFields,
            }) => ({
              productCode,
              name,
              unitOfMeasures,
              baseUnitOfMeasures,
              conversionFactor,
              site,
              vendor,
              currency,
              minimumQuantity,
              priceQuantity,
              price,
              extraFields,
            }),
          ),
        );
        await this.rawMaterials.bulkUpsertVendorPrices(
          rowsToSave.map(
            ({
              productCode,
              name,
              unitOfMeasures,
              site,
              vendor,
              currency,
              minimumQuantity,
              priceQuantity,
              price,
              extraFields,
            }) => ({
              productCode,
              name,
              unitOfMeasures,
              site,
              vendor,
              currency,
              minimumQuantity,
              priceQuantity,
              price,
              extraFields,
            }),
          ),
        );
        successCount += rowsToSave.length;
      } catch (error) {
        newlyImportedCodes.forEach((code) => importedProductCodes.delete(code));
        this.logger.warn(
          `Raw material batch failed: ${(error as Error).message}`,
        );
        rowsToSave.forEach((item) =>
          pushError({
            row: item.row,
            name: item.name,
            reason: 'Failed to save raw material',
          }),
        );
      }
    };

    try {
      this.notifications.emitJobProgress(userId, {
        jobId: job.id,
        processed,
        successCount,
        failCount,
      });
      if (!filePath && !fileKey) {
        throw new Error('File not found for raw material import.');
      }

      const stream = filePath
        ? createReadStream(filePath)
        : await this.files.getObjectStream(fileKey!);
      const useExcel = this.isExcelFile(fileName ?? filePath, contentType);
      const rows = useExcel
        ? this.rawMaterialRowsFromExcel(stream)
        : this.rawMaterialRowsFromCsv(stream);

      const batch: Array<{
        productCode: string;
        name: string;
        unitOfMeasures: string;
        baseUnitOfMeasures?: string;
        conversionFactor?: number;
        site?: string;
        vendor?: string;
        currency?: string;
        minimumQuantity?: number;
        priceQuantity?: number;
        price?: number;
        extraFields?: Record<string, string>;
        row: number;
      }> = [];
      const batchSize = 1000;

      const throwIfCancelled = async () => {
        if (await this.isCancellationRequested(job)) {
          throw new Error(RAW_MATERIAL_IMPORT_CANCELLED_REASON);
        }
      };

      await throwIfCancelled();

      for await (const record of rows) {
        if (processed > 0 && processed % batchSize === 0) {
          await throwIfCancelled();
        }

        processed += 1;
        const productCode = record.productCode.trim();
        const name = record.name.trim();
        const unitOfMeasures = record.unitOfMeasures.trim();
        const site = record.site;
        const baseUnitOfMeasures = this.normalizeOptionalText(
          record.baseUnitOfMeasures,
        );
        const conversionFactor = record.conversionFactor;
        const vendor = record.vendor;
        const currency = record.currency;
        const minimumQuantity = record.minimumQuantity;
        const priceQuantity = record.priceQuantity;
        const price = record.price;
        const extraFields = record.extraFields;

        if (!productCode || !name || !unitOfMeasures) {
          pushError({
            row: record.rowNumber,
            name,
            reason: 'productCode, name, unitOfMeasures required',
          });
          continue;
        }

        batch.push({
          productCode,
          name,
          unitOfMeasures,
          baseUnitOfMeasures,
          conversionFactor,
          site,
          vendor,
          currency,
          minimumQuantity,
          priceQuantity,
          price,
          extraFields,
          row: record.rowNumber,
        });

        if (batch.length >= batchSize) {
          await throwIfCancelled();
          await flushBatch(batch);
          batch.length = 0;
          await throwIfCancelled();
        }

        if (processed % 1000 === 0) {
          this.notifications.emitJobProgress(userId, {
            jobId: job.id,
            processed,
            successCount,
            failCount,
          });
        }
      }

      await throwIfCancelled();
      await flushBatch(batch);

      const summary = { successCount, failCount, errors };
      await this.notifications.create(
        userId,
        'Raw material import completed',
        `Raw material import finished. Success: ${successCount}, failed: ${failCount}.`,
        summary,
      );
      this.notifications.emitJobDone(userId, { jobId: job.id, ...summary });
    } catch (error) {
      const reason = (error as Error).message;
      if (reason === RAW_MATERIAL_IMPORT_CANCELLED_REASON) {
        const summary = { successCount, failCount, errors, reason };
        await this.notifications.create(
          userId,
          'Raw material import cancelled',
          `Raw material import was cancelled. Success before cancellation: ${successCount}, failed: ${failCount}.`,
          summary,
        );
        this.notifications.emitJobFailed(userId, { jobId: job.id, reason });
        return;
      }

      await this.notifications.create(
        userId,
        'Raw material import failed',
        'An error occurred while processing the raw material import file.',
        { successCount, failCount, errors, reason },
      );
      this.notifications.emitJobFailed(userId, { jobId: job.id, reason });
      throw error;
    } finally {
      if (filePath) {
        fs.unlink(filePath).catch(() => null);
      }
    }
  }

  private async isCancellationRequested(job: Job<ImportJob>) {
    if (job.data.cancelRequested) return true;
    if (!job.id) return false;

    const latestJob = await this.importsQueue.getJob(job.id);
    return Boolean(latestJob?.data.cancelRequested);
  }

  private async *rawMaterialRowsFromCsv(stream: Readable) {
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
    const rows = stream.pipe(parser);
    let rowNumber = 0;

    for await (const record of rows) {
      rowNumber += 1;
      const normalized = this.normalizeRecord(
        record as Record<string, unknown>,
      );
      const productCode = this.pickValue(
        normalized,
        RAW_MATERIAL_HEADER_ALIASES.productCode,
      );
      const name = this.pickValue(normalized, RAW_MATERIAL_HEADER_ALIASES.name);
      const unitOfMeasures = this.pickValue(
        normalized,
        RAW_MATERIAL_HEADER_ALIASES.unitOfMeasures,
      );
      const site = this.pickValue(normalized, RAW_MATERIAL_HEADER_ALIASES.site);
      const baseUnitOfMeasures = this.pickValue(
        normalized,
        RAW_MATERIAL_HEADER_ALIASES.baseUnitOfMeasures,
      );
      const conversionFactorRaw = this.pickValue(
        normalized,
        RAW_MATERIAL_HEADER_ALIASES.conversionFactor,
      );
      const vendor = this.pickValue(
        normalized,
        RAW_MATERIAL_HEADER_ALIASES.vendor,
      );
      const currency = this.pickValue(
        normalized,
        RAW_MATERIAL_HEADER_ALIASES.currency,
      );
      const minimumQuantityRaw = this.pickValue(
        normalized,
        RAW_MATERIAL_HEADER_ALIASES.minimumQuantity,
      );
      const priceQuantityRaw = this.pickValue(
        normalized,
        RAW_MATERIAL_HEADER_ALIASES.priceQuantity,
      );
      const priceRaw = this.pickValue(
        normalized,
        RAW_MATERIAL_HEADER_ALIASES.price,
      );
      const minimumQuantity = this.parseNumber(minimumQuantityRaw);
      const priceQuantity = this.parseNumber(priceQuantityRaw);
      const price = this.parseNumber(priceRaw);
      const conversionFactor = this.parseNumber(conversionFactorRaw);
      const extraFields: Record<string, string> = {};
      for (const [key, value] of Object.entries(normalized)) {
        if (!key || RAW_MATERIAL_RESERVED_HEADERS.has(key)) continue;
        extraFields[key] = this.toText(value);
      }

      yield {
        rowNumber,
        productCode,
        name,
        unitOfMeasures,
        baseUnitOfMeasures: this.normalizeOptionalText(baseUnitOfMeasures),
        conversionFactor,
        site: this.normalizeOptionalText(site),
        vendor: this.normalizeOptionalText(vendor),
        currency: this.normalizeOptionalText(currency),
        minimumQuantity,
        priceQuantity,
        price,
        extraFields,
      };
    }
  }

  private async *rawMaterialRowsFromExcel(stream: Readable) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
      worksheets: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
    });

    let headerMap: RawMaterialHeaderMap | null = null;

    for await (const worksheet of workbook) {
      for await (const row of worksheet) {
        const values = Array.isArray(row.values) ? row.values : [];

        if (!headerMap) {
          headerMap = this.buildHeaderMap(values);
          continue;
        }

        const productCode = this.getCellValue(values, headerMap.productCode);
        const name = this.getCellValue(values, headerMap.name);
        const unitOfMeasures = this.getCellValue(
          values,
          headerMap.unitOfMeasures,
        );
        const site = this.getCellValue(values, headerMap.site);
        const baseUnitOfMeasures = this.getCellValue(
          values,
          headerMap.baseUnitOfMeasures,
        );
        const conversionFactorRaw = this.getCellValue(
          values,
          headerMap.conversionFactor,
        );
        const vendor = this.getCellValue(values, headerMap.vendor);
        const currency = this.getCellValue(values, headerMap.currency);
        const minimumQuantityRaw = this.getCellValue(
          values,
          headerMap.minimumQuantity,
        );
        const priceQuantityRaw = this.getCellValue(
          values,
          headerMap.priceQuantity,
        );
        const priceRaw = this.getCellValue(values, headerMap.price);
        const minimumQuantity = this.parseNumber(minimumQuantityRaw);
        const priceQuantity = this.parseNumber(priceQuantityRaw);
        const price = this.parseNumber(priceRaw);
        const conversionFactor = this.parseNumber(conversionFactorRaw);
        const extraFields: Record<string, string> = {};
        for (const [key, index] of Object.entries(headerMap.extraFields)) {
          extraFields[key] = this.getCellValue(values, index);
        }

        yield {
          rowNumber: row.number,
          productCode,
          name,
          unitOfMeasures,
          baseUnitOfMeasures: this.normalizeOptionalText(baseUnitOfMeasures),
          conversionFactor,
          site: this.normalizeOptionalText(site),
          vendor: this.normalizeOptionalText(vendor),
          currency: this.normalizeOptionalText(currency),
          minimumQuantity,
          priceQuantity,
          price,
          extraFields,
        };
      }
      break;
    }

    if (!headerMap) {
      throw new Error('Header row not found for raw material import.');
    }
  }

  private normalizeRecord(record: Record<string, unknown>) {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const nextKey = this.normalizeHeader(key);
      normalized[nextKey] = value;
    }
    return normalized;
  }

  private pickValue(record: Record<string, unknown>, aliases: string[]) {
    for (const alias of aliases) {
      if (alias in record) {
        return this.toText(record[alias]);
      }
    }
    return '';
  }

  private buildHeaderMap(values: unknown[]): RawMaterialHeaderMap {
    const map: RawMaterialHeaderMap = {
      productCode: 0,
      name: 0,
      unitOfMeasures: 0,
      baseUnitOfMeasures: 0,
      conversionFactor: 0,
      site: 0,
      vendor: 0,
      currency: 0,
      minimumQuantity: 0,
      priceQuantity: 0,
      price: 0,
      extraFields: {},
    };

    for (let idx = 1; idx < values.length; idx += 1) {
      const header = this.normalizeHeader(values[idx]);
      if (!header) continue;
      if (RAW_MATERIAL_HEADER_ALIASES.productCode.includes(header)) {
        map.productCode = idx;
        continue;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.name.includes(header)) {
        map.name = idx;
        continue;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.unitOfMeasures.includes(header)) {
        map.unitOfMeasures = idx;
        continue;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.baseUnitOfMeasures.includes(header)) {
        map.baseUnitOfMeasures = idx;
        continue;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.conversionFactor.includes(header)) {
        map.conversionFactor = idx;
        continue;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.site.includes(header)) {
        map.site = idx;
        continue;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.vendor.includes(header)) {
        map.vendor = idx;
        continue;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.currency.includes(header)) {
        map.currency = idx;
        continue;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.minimumQuantity.includes(header)) {
        map.minimumQuantity = idx;
        continue;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.priceQuantity.includes(header)) {
        map.priceQuantity = idx;
        continue;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.price.includes(header)) {
        map.price = idx;
        continue;
      }
      map.extraFields[header] = idx;
    }

    if (!map.productCode || !map.name || !map.unitOfMeasures) {
      throw new Error(
        'Header must include product code, name, and unit of measures for raw material import.',
      );
    }

    return map;
  }

  private getCellValue(values: unknown[], index: number) {
    const cell = values[index];
    if (cell === undefined || cell === null) return '';
    if (typeof cell === 'object' && cell && 'text' in cell) {
      const text = (cell as { text?: unknown }).text;
      return typeof text === 'string' ? text.trim() : '';
    }
    return this.toText(cell);
  }

  private isExcelFile(fileName?: string, contentType?: string) {
    if (fileName && /\.(xlsx|xls)$/i.test(fileName)) return true;
    if (contentType && contentType.includes('sheet')) return true;
    return false;
  }

  private normalizeHeader(value: unknown) {
    return this.toText(value)
      .trim()
      .toLowerCase()
      .replace(/\./g, '_')
      .replace(/\$/g, '');
  }

  private getRecordText(record: ProductImportCsvRecord, key: string) {
    return this.toText(record[key]);
  }

  private toText(value: unknown) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim();
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object' && 'text' in value) {
      const text = (value as { text?: unknown }).text;
      return typeof text === 'string' ? text.trim() : '';
    }
    return '';
  }

  private normalizeOptionalText(value?: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private parseNumber(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    let normalized = trimmed.replace(/\s/g, '');
    if (normalized.includes(',') && normalized.includes('.')) {
      normalized = normalized.replace(/,/g, '');
    } else if (normalized.includes(',') && !normalized.includes('.')) {
      normalized = normalized.replace(',', '.');
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private normalizeProductCode(value: string) {
    return value.trim().toLowerCase();
  }
}
