import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '../types/jwt-payload.type';
import { UsersService } from '../../users/users.service';
import { AppRole } from '../roles.constants';
import { SitesService } from '../../sites/sites.service';

const DEFAULT_IDLE_TIMEOUT_MINUTES = 8 * 60;
const ACTIVITY_UPDATE_MIN_INTERVAL_MS = 60_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly sites: SitesService,
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
    if (
      !user ||
      !user.isActive ||
      !user.refreshTokenHash ||
      (payload.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)
    ) {
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

    // Corporate permissions follow current database settings, never token claims.
    const scopedPayload = {
      ...payload,
      corporateSite: false,
      approvalSites: undefined as string[] | undefined,
    };
    if (payload.roles.includes(AppRole.CorporateChef)) {
      const primary = user.siteId
        ? await this.sites.findSummaryById(user.siteId)
        : (await this.sites.findSummariesByCodes([payload.site ?? ''])).get(
            payload.site ?? '',
          );
      if (primary) {
        scopedPayload.site = primary.code;
        scopedPayload.siteName = primary.name;
        scopedPayload.corporateSite =
          primary.isActive && primary.siteFunction === 'corporate';
      }
      if (scopedPayload.corporateSite) {
        scopedPayload.approvalSites = (
          await this.sites.findApprovalSites()
        ).map((site) => site.code);
      }
    }
    return scopedPayload;
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
