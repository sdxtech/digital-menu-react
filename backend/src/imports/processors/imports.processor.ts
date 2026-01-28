import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { parse } from 'csv-parse';
import { REDIS_OPTIONS } from '../../redis/redis.constants';
import { Inject } from '@nestjs/common';
import { FilesService } from '../../files/files.service';
import { ProductsService } from '../../products/products.service';
import { NotificationsService } from '../../notifications/notifications.service';

type ImportJob = {
  userId: string;
  fileKey: string;
  kind: 'products' | 'users' | 'categories';
};

@Injectable()
export class ImportsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportsProcessor.name);
  private worker?: Worker<ImportJob>;

  constructor(
    @Inject(REDIS_OPTIONS) private readonly redisOptions: RedisOptions,
    private readonly files: FilesService,
    private readonly products: ProductsService,
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
    const { userId, fileKey, kind } = job.data;
    if (kind !== 'products') {
      await this.notifications.create(userId, 'Import gagal', 'Jenis import tidak didukung', {
        kind,
      });
      return;
    }

    try {
      const stream = await this.files.getObjectStream(fileKey);
      const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
      const rows = stream.pipe(parser);

      let success = 0;
      let failed = 0;

      for await (const record of rows) {
        const name = String(record.name || '').trim();
        const priceValue = Number(record.price);
        const category = record.category ? String(record.category).trim() : undefined;

        if (!name || Number.isNaN(priceValue)) {
          failed += 1;
          continue;
        }

        try {
          await this.products.create({
            userId,
            name,
            price: priceValue,
            category,
          });
          success += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(`Import row failed: ${(error as Error).message}`);
        }
      }

      await this.notifications.create(
        userId,
        'Import selesai',
        `Import selesai. Sukses: ${success}, gagal: ${failed}.`,
        { success, failed },
      );
    } catch (error) {
      await this.notifications.create(
        userId,
        'Import gagal',
        'Terjadi kesalahan saat memproses file import.',
        { reason: (error as Error).message },
      );
      throw error;
    }
  }
}
