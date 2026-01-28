import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { REDIS_OPTIONS } from '../../redis/redis.constants';
import { Inject } from '@nestjs/common';
import { ProductsService } from '../../products/products.service';
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
    const products = await this.products.findAllByUser(userId);
    const csv = this.buildCsv(products);

    const key = `exports/${randomUUID()}.csv`;
    const publicUrl = await this.files.uploadObject(
      key,
      Readable.from([csv]),
      'text/csv',
    );

    await this.notifications.create(
      userId,
      'Export selesai',
      `Export produk selesai. Total: ${products.length}.`,
      { url: publicUrl, count: products.length },
    );
  }

  private buildCsv(
    products: Array<{ name: string; price: number; category?: string | null }>,
  ) {
    const lines: string[] = [];
    lines.push('name,price,category');

    for (const product of products) {
      lines.push(
        [
          this.escapeCsv(product.name),
          this.escapeCsv(String(product.price)),
          this.escapeCsv(product.category ?? ''),
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
