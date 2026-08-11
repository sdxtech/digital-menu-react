import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { REDIS_OPTIONS } from '../../redis/redis.constants';
import { Inject } from '@nestjs/common';
import type { MailJob } from '../mail.types';
import { HostingerMailClient } from '../hostinger-mail.client';

@Injectable()
export class MailProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailProcessor.name);
  private worker?: Worker<MailJob>;

  constructor(
    @Inject(REDIS_OPTIONS) private readonly redisOptions: RedisOptions,
    private readonly hostingerMail: HostingerMailClient,
  ) {}

  onModuleInit() {
    if (process.env.VERCEL === '1') return;

    this.worker = new Worker<MailJob>(
      'mail',
      async (job: Job<MailJob>) => {
        await this.hostingerMail.send(job.data);
        this.logger.log(
          `Mail job ${job.id ?? 'unknown'} sent via Hostinger Mail API`,
        );
      },
      { connection: this.redisOptions },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Mail job ${job?.id ?? 'unknown'} failed: ${error.message}`,
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error(`Mail worker error: ${error.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
