import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import { Connection, ConnectionStates } from 'mongoose';
import { REDIS_CLIENT } from '../redis/redis.constants';

type DependencyStatus = 'up' | 'down';

type DependencyResult = {
  status: DependencyStatus;
  detail: string;
};

export type ReadinessResult = {
  status: 'ok' | 'degraded';
  dependencies: {
    mongo: DependencyResult;
    redis: DependencyResult;
  };
  timestamp: string;
};

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  getLiveness() {
    return {
      status: 'ok' as const,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessResult> {
    const mongo = this.checkMongo();
    const redis = await this.checkRedis();

    return {
      status:
        mongo.status === 'up' && redis.status === 'up' ? 'ok' : 'degraded',
      dependencies: { mongo, redis },
      timestamp: new Date().toISOString(),
    };
  }

  private checkMongo(): DependencyResult {
    const readyState = this.mongoConnection.readyState;
    if (readyState === ConnectionStates.connected) {
      return { status: 'up', detail: 'connected' };
    }

    const stateLabel =
      readyState === ConnectionStates.disconnected
        ? 'disconnected'
        : readyState === ConnectionStates.connecting
          ? 'connecting'
          : readyState === ConnectionStates.disconnecting
            ? 'disconnecting'
            : 'uninitialized';

    return { status: 'down', detail: stateLabel };
  }

  private async checkRedis(): Promise<DependencyResult> {
    try {
      const response = await this.redis.ping();
      if (response === 'PONG') {
        return { status: 'up', detail: 'pong' };
      }
      return { status: 'down', detail: 'unexpected redis response' };
    } catch (error) {
      return {
        status: 'down',
        detail: error instanceof Error ? error.message : 'redis ping failed',
      };
    }
  }
}
