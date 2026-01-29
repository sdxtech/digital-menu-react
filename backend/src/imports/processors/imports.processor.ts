import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { parse } from 'csv-parse';
import { Inject } from '@nestjs/common';
import { REDIS_OPTIONS } from '../../redis/redis.constants';
import { FilesService } from '../../files/files.service';
import { ProductsService } from '../../products/products.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CategoriesService } from '../../categories/categories.service';

type ImportJob = {
  userId: string;
  fileKey: string;
};

type ImportError = {
  row: number;
  name?: string;
  reason: string;
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
        'Import selesai',
        `Import selesai. Sukses: ${successCount}, gagal: ${failCount}.`,
        summary,
      );
      this.notifications.emitJobDone(userId, { jobId: job.id, ...summary });
    } catch (error) {
      const reason = (error as Error).message;
      await this.notifications.create(
        userId,
        'Import gagal',
        'Terjadi kesalahan saat memproses file import.',
        { successCount, failCount, errors, reason },
      );
      this.notifications.emitJobFailed(userId, { jobId: job.id, reason });
      throw error;
    }
  }
}
