import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { createTransport } from 'nodemailer';
import { REDIS_OPTIONS } from '../../redis/redis.constants';
import { Inject } from '@nestjs/common';

type MailJob = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from: string;
};

@Injectable()
export class MailProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailProcessor.name);
  private worker?: Worker<MailJob>;

  constructor(
    @Inject(REDIS_OPTIONS) private readonly redisOptions: RedisOptions,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const transport = createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: Number(this.config.getOrThrow<string>('SMTP_PORT')),
      secure: Number(this.config.getOrThrow<string>('SMTP_PORT')) === 465,
      auth: {
        user: this.config.getOrThrow<string>('SMTP_USER'),
        pass: this.config.getOrThrow<string>('SMTP_PASS'),
      },
    });

    this.worker = new Worker<MailJob>(
      'mail',
      async (job: Job<MailJob>) => {
        await transport.sendMail({
          from: job.data.from,
          to: job.data.to,
          subject: job.data.subject,
          text: job.data.text,
          html: job.data.html,
        });

        this.logger.log(`Mail sent to ${job.data.to}`);
      },
      { connection: this.redisOptions },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
