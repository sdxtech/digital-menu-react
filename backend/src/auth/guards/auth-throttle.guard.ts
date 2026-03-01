import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ThrottleBucket = {
  count: number;
  resetAt: number;
};

@Injectable()
export class AuthThrottleGuard implements CanActivate {
  private readonly buckets = new Map<string, ThrottleBucket>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(private readonly config: ConfigService) {
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

  canActivate(context: ExecutionContext): boolean {
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
    const now = Date.now();

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      this.pruneBuckets(now);
      return true;
    }

    if (existing.count >= this.maxRequests) {
      throw new HttpException(
        'Too many auth requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    existing.count += 1;
    return true;
  }

  private pruneBuckets(now: number) {
    if (this.buckets.size < 500) return;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
