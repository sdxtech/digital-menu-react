import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { type RedisOptions } from 'ioredis';
import { REDIS_CLIENT, REDIS_OPTIONS } from './redis.constants';
import { parseRedisUrl } from './redis.utils';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RedisOptions =>
        parseRedisUrl(config.get<string>('REDIS_URL')),
    },
    {
      provide: REDIS_CLIENT,
      inject: [REDIS_OPTIONS],
      useFactory: (options: RedisOptions) => {
        const client = new IORedis({
          ...options,
          connectTimeout: 3000,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null,
        });
        client.on('error', () => undefined);
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT, REDIS_OPTIONS],
})
export class RedisModule {}
