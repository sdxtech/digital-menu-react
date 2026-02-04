import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { REDIS_OPTIONS } from '../../redis/redis.constants';
import { Inject } from '@nestjs/common';
import { ExportProductRow, ProductsService } from '../../products/products.service';
import { FilesService } from '../../files/files.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

type ExportJob = {
  userId: string;
};

@Injectable()
export class ExportsProcessor implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<ExportJob>;

  constructor(
    @Inject(REDIS_OPTIONS) private readonly redisOptions: RedisOptions,
    private readonly products: ProductsService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ExportJob>(
      'exports',
      async (job) => this.handle(job),
      { connection: this.redisOptions },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async handle(job: Job<ExportJob>) {
    const { userId } = job.data;
    try {
      this.notifications.emitJobProgress(userId, { jobId: job.id, stage: 'start' });
      const products = await this.products.findActiveForExport();
      const csv = this.buildCsv(products);

      const key = `exports/${randomUUID()}.csv`;
      const publicUrl = await this.files.uploadObject(
        key,
        Readable.from([csv]),
        'text/csv',
      );

      const summary = { url: publicUrl, count: products.length };
      await this.notifications.create(
        userId,
        'Export completed',
        `Product export completed. Total: ${products.length}.`,
        summary,
      );
      this.notifications.emitJobDone(userId, { jobId: job.id, ...summary });
    } catch (error) {
      const reason = (error as Error).message;
      await this.notifications.create(
        userId,
        'Export failed',
        'An error occurred while processing the product export.',
        { reason },
      );
      this.notifications.emitJobFailed(userId, { jobId: job.id, reason });
      throw error;
    }
  }

  private buildCsv(products: ExportProductRow[]) {
    const lines: string[] = [];
    lines.push('name,price,category,description,imageUrl');

    for (const product of products) {
      const categoryName =
        product.categoryId && typeof product.categoryId === 'object'
          ? product.categoryId.name ?? ''
          : '';
      lines.push(
        [
          this.escapeCsv(product.name),
          this.escapeCsv(String(product.price)),
          this.escapeCsv(categoryName),
          this.escapeCsv(product.description ?? ''),
          this.escapeCsv(product.imageUrl ?? ''),
        ].join(','),
      );
    }

    return lines.join('\n');
  }

  private escapeCsv(value: string) {
    if (value.includes('"') || value.includes(',') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
