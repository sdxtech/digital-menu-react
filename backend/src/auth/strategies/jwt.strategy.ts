import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '../types/jwt-payload.type';
import { UsersService } from '../../users/users.service';
import { AppRole } from '../roles.constants';

const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
const ACTIVITY_UPDATE_MIN_INTERVAL_MS = 60_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });

    this.idleTimeoutMs = this.resolveIdleTimeoutMs(
      this.config.get<string>('AUTH_IDLE_TIMEOUT_MINUTES'),
    );
  }

  async validate(payload: JwtPayload) {
    const user = await this.users.findByIdWithSessionState(payload.sub);
    if (!user || !user.isActive || !user.refreshTokenHash) {
      throw new UnauthorizedException('SESSION_REVOKED');
    }

    if (!this.hasValidRole(payload.roles)) {
      await this.users.setRefreshToken(user.id, null);
      throw new UnauthorizedException('User role is required');
    }

    if (!payload.roles?.includes(AppRole.Superadmin) && !payload.site?.trim()) {
      throw new UnauthorizedException('SITE_REQUIRED');
    }

    if (this.isSessionIdle(user.lastActivityAt)) {
      await this.users.setRefreshToken(user.id, null);
      throw new UnauthorizedException('SESSION_IDLE_TIMEOUT');
    }

    await this.users.touchLastActivity(
      user.id,
      ACTIVITY_UPDATE_MIN_INTERVAL_MS,
    );

    return payload;
  }

  private resolveIdleTimeoutMs(value?: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_IDLE_TIMEOUT_MINUTES * 60 * 1000;
    }
    return Math.floor(parsed) * 60 * 1000;
  }

  private isSessionIdle(lastActivityAt?: Date) {
    if (!lastActivityAt) return false;
    return Date.now() - lastActivityAt.getTime() > this.idleTimeoutMs;
  }

  private hasValidRole(roles?: AppRole[]) {
    if (!roles?.length) return false;
    return roles.some((role) => Object.values(AppRole).includes(role));
  }
}
