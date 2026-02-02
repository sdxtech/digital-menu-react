import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { REDIS_OPTIONS } from '../redis/redis.constants';
import { RedisModule } from '../redis/redis.module';
import { EXPORTS_QUEUE, IMPORTS_QUEUE, MAIL_QUEUE } from './queue.constants';

class QueueLifecycle implements OnModuleDestroy {
  constructor(
    @Inject(IMPORTS_QUEUE) private readonly importsQueue: Queue,
    @Inject(EXPORTS_QUEUE) private readonly exportsQueue: Queue,
    @Inject(MAIL_QUEUE) private readonly mailQueue: Queue,
  ) {}

  async onModuleDestroy() {
    await Promise.all([
      this.importsQueue.close(),
      this.exportsQueue.close(),
      this.mailQueue.close(),
    ]);
  }
}

@Global()
@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: IMPORTS_QUEUE,
      inject: [REDIS_OPTIONS],
      useFactory: (options: RedisOptions) => new Queue('imports', { connection: options }),
    },
    {
      provide: EXPORTS_QUEUE,
      inject: [REDIS_OPTIONS],
      useFactory: (options: RedisOptions) => new Queue('exports', { connection: options }),
    },
    {
      provide: MAIL_QUEUE,
      inject: [REDIS_OPTIONS],
      useFactory: (options: RedisOptions) => new Queue('mail', { connection: options }),
    },
    QueueLifecycle,
  ],
  exports: [IMPORTS_QUEUE, EXPORTS_QUEUE, MAIL_QUEUE, RedisModule],
})
export class QueueModule {}
