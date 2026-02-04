import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { createReadStream, promises as fs } from 'fs';
import { Inject } from '@nestjs/common';
import { REDIS_OPTIONS } from '../../redis/redis.constants';
import { FilesService } from '../../files/files.service';
import { ProductsService } from '../../products/products.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CategoriesService } from '../../categories/categories.service';
import { RawMaterialsService } from '../../raw-materials/raw-materials.service';

type ImportJob = {
  userId: string;
  fileKey: string;
  fileName?: string;
  contentType?: string;
  filePath?: string;
};

type ImportError = {
  row: number;
  name?: string;
  reason: string;
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
};

@Injectable()
export class ImportsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportsProcessor.name);
  private worker?: Worker<ImportJob>;

  constructor(
    @Inject(REDIS_OPTIONS) private readonly redisOptions: RedisOptions,
    private readonly files: FilesService,
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly rawMaterials: RawMaterialsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
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

    const { userId, fileKey } = job.data;
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
      const stream = await this.files.getObjectStream(fileKey);
      const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
      const rows = stream.pipe(parser);

      for await (const record of rows) {
        processed += 1;
        const name = String(record.name || '').trim();
        const priceValue = Number(record.price);
        const categoryRaw = record.category ? String(record.category).trim() : '';
        const description = record.description ? String(record.description).trim() : undefined;
        const imageUrl = record.imageUrl ? String(record.imageUrl).trim() : undefined;

        if (!name) {
          pushError({ row: processed, reason: 'Name is required' });
          continue;
        }

        if (Number.isNaN(priceValue) || priceValue < 0) {
          pushError({ row: processed, name, reason: 'Price is invalid' });
          continue;
        }

        // Chosen strategy: skip duplicates (case-insensitive) to avoid overwriting existing data.
        const existing = await this.products.findByNameInsensitive(name);
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
            const category = await this.categories.findOrCreateByName(categoryRaw);
            categoryId = category.id;
            categoryCache.set(key, categoryId);
          }
        }

        try {
          await this.products.create({
            name,
            price: priceValue,
            categoryId,
            description,
            imageUrl,
            isActive: true,
          });
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

    const pushError = (error: ImportError) => {
      failCount += 1;
      if (errors.length < 50) errors.push(error);
    };

    const flushBatch = async (
      batch: Array<{ productCode: string; name: string; unitOfMeasures: string; row: number }>,
    ) => {
      if (batch.length === 0) return;
      try {
        const result = await this.rawMaterials.bulkUpsertByProductCode(
          batch.map(({ productCode, name, unitOfMeasures }) => ({
            productCode,
            name,
            unitOfMeasures,
          })),
        );
        successCount += result.upsertedCount + result.matchedCount;
      } catch (error) {
        this.logger.warn(`Raw material batch failed: ${(error as Error).message}`);
        batch.forEach((item) =>
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
        : await this.files.getObjectStream(fileKey);
      const useExcel = this.isExcelFile(fileName ?? filePath, contentType);
      const rows = useExcel
        ? this.rawMaterialRowsFromExcel(stream)
        : this.rawMaterialRowsFromCsv(stream);

      const batch = new Map<
        string,
        { productCode: string; name: string; unitOfMeasures: string; row: number }
      >();
      const batchSize = 1000;

      for await (const record of rows) {
        processed += 1;
        const productCode = record.productCode.trim();
        const name = record.name.trim();
        const unitOfMeasures = record.unitOfMeasures.trim();

        if (!productCode || !name || !unitOfMeasures) {
          pushError({
            row: record.rowNumber,
            name,
            reason: 'productCode, name, unitOfMeasures required',
          });
          continue;
        }

        const normalizedCode = this.normalizeHeader(productCode);
        batch.set(normalizedCode, {
          productCode,
          name,
          unitOfMeasures,
          row: record.rowNumber,
        });

        if (batch.size >= batchSize) {
          await flushBatch(Array.from(batch.values()));
          batch.clear();
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

      await flushBatch(Array.from(batch.values()));

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

  private async *rawMaterialRowsFromCsv(stream: Readable) {
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
    const rows = stream.pipe(parser);
    let rowNumber = 0;

    for await (const record of rows) {
      rowNumber += 1;
      const normalized = this.normalizeRecord(record as Record<string, unknown>);
      const productCode = this.pickValue(normalized, RAW_MATERIAL_HEADER_ALIASES.productCode);
      const name = this.pickValue(normalized, RAW_MATERIAL_HEADER_ALIASES.name);
      const unitOfMeasures = this.pickValue(
        normalized,
        RAW_MATERIAL_HEADER_ALIASES.unitOfMeasures,
      );

      yield {
        rowNumber,
        productCode,
        name,
        unitOfMeasures,
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

    let headerMap: { productCode: number; name: number; unitOfMeasures: number } | null =
      null;

    for await (const worksheet of workbook) {
      for await (const row of worksheet) {
        const values = Array.isArray(row.values) ? row.values : [];

        if (!headerMap) {
          headerMap = this.buildHeaderMap(values);
          continue;
        }

        const productCode = this.getCellValue(values, headerMap.productCode);
        const name = this.getCellValue(values, headerMap.name);
        const unitOfMeasures = this.getCellValue(values, headerMap.unitOfMeasures);

        yield {
          rowNumber: row.number,
          productCode,
          name,
          unitOfMeasures,
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
        const value = record[alias];
        if (value === undefined || value === null) return '';
        return String(value).trim();
      }
    }
    return '';
  }

  private buildHeaderMap(values: unknown[]) {
    const map = {
      productCode: 0,
      name: 0,
      unitOfMeasures: 0,
    };

    for (let idx = 1; idx < values.length; idx += 1) {
      const header = this.normalizeHeader(values[idx]);
      if (!header) continue;
      if (RAW_MATERIAL_HEADER_ALIASES.productCode.includes(header)) {
        map.productCode = idx;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.name.includes(header)) {
        map.name = idx;
      }
      if (RAW_MATERIAL_HEADER_ALIASES.unitOfMeasures.includes(header)) {
        map.unitOfMeasures = idx;
      }
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
      return String((cell as { text?: unknown }).text ?? '').trim();
    }
    return String(cell).trim();
  }

  private isExcelFile(fileName?: string, contentType?: string) {
    if (fileName && /\.(xlsx|xls)$/i.test(fileName)) return true;
    if (contentType && contentType.includes('sheet')) return true;
    return false;
  }

  private normalizeHeader(value: unknown) {
    return String(value ?? '').trim().toLowerCase();
  }
}
