import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';

@Injectable()
export class AuthThrottleGuard implements CanActivate {
  private readonly logger = new Logger(AuthThrottleGuard.name);
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const configuredMax = Number(
      this.config.get<string>('AUTH_RATE_LIMIT_MAX'),
    );
    const configuredWindow = Number(
      this.config.get<string>('AUTH_RATE_LIMIT_WINDOW_MS'),
    );

    this.maxRequests =
      Number.isFinite(configuredMax) && configuredMax > 0
        ? Math.floor(configuredMax)
        : 10;
    this.windowMs =
      Number.isFinite(configuredWindow) && configuredWindow > 0
        ? Math.floor(configuredWindow)
        : 60_000;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      ip?: string;
      path?: string;
      route?: { path?: string };
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const forwardedFor = request.headers?.['x-forwarded-for'];
    const forwardedIp =
      typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0]?.trim()
        : undefined;
    const ip = forwardedIp || request.ip || 'unknown';
    const route = request.route?.path || request.path || 'auth';
    const key = `${route}:${ip}`;
    const bucketKey = `throttle:auth:${key}`;

    try {
      const count = await this.redis.incr(bucketKey);
      if (count === 1) {
        await this.redis.pexpire(bucketKey, this.windowMs);
      }

      if (count > this.maxRequests) {
        throw new HttpException(
          'Too many auth requests. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Failed to apply auth throttle, allowing request: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    return true;
  }
}
