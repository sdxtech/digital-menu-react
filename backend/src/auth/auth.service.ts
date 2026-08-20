import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import type { Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { SitesService } from '../sites/sites.service';
import { resolveExpiresIn } from './jwt.utils';
import { AppRole } from './roles.constants';

const DEFAULT_IDLE_TIMEOUT_MINUTES = 8 * 60;

type UserSiteInput = {
  roles?: AppRole[];
  sites?: string[];
  siteId?: string | Types.ObjectId | null;
};

type AuthSiteContext = {
  site?: string;
  siteId?: string;
  siteName?: string;
  sites?: string[];
};

@Injectable()
export class AuthService {
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly users: UsersService,
    private readonly sites: SitesService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.idleTimeoutMs = this.resolveIdleTimeoutMs(
      this.config.get<string>('AUTH_IDLE_TIMEOUT_MINUTES'),
    );
  }

  async register(name: string, email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.users.create({ name, email, passwordHash });

    const roles = user.roles;
    const siteContext = await this.resolveUserSite(user);
    const tokens = await this.issueTokens(
      user.id,
      user.name,
      user.email,
      roles,
      siteContext,
    );
    await this.users.setRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email, true);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('User disabled');

    const roles = user.roles;
    this.resolveAppRole(roles);
    const siteContext = await this.resolveUserSite(user);
    const tokens = await this.issueTokens(
      user.id,
      user.name,
      user.email,
      roles,
      siteContext,
    );
    await this.users.setRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async refresh(refreshToken: string) {
    try {
      const refreshSecret =
        this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
      const payload = await this.jwt.verifyAsync<{ sub: string }>(
        refreshToken,
        {
          secret: refreshSecret,
        },
      );

      const user = await this.users.findByIdWithRefreshToken(payload.sub);
      if (!user || !user.isActive)
        throw new UnauthorizedException('Invalid refresh token');
      if (!user.refreshTokenHash)
        throw new UnauthorizedException('Invalid refresh token');
      if (this.isSessionIdle(user.lastActivityAt)) {
        await this.users.setRefreshToken(user.id, null);
        throw new UnauthorizedException('SESSION_IDLE_TIMEOUT');
      }

      const matches = await bcrypt.compare(refreshToken, user.refreshTokenHash);
      if (!matches) throw new UnauthorizedException('Invalid refresh token');

      const roles = user.roles;
      this.resolveAppRole(roles);
      const siteContext = await this.resolveUserSite(user);
      const tokens = await this.issueTokens(
        user.id,
        user.name,
        user.email,
        roles,
        siteContext,
      );
      await this.users.setRefreshToken(user.id, tokens.refreshToken);
      return tokens;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
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

  private resolveAppRole(roles: AppRole[] = []) {
    if (roles.includes(AppRole.Superadmin)) return 'superadmin';
    if (roles.includes(AppRole.UnitManager)) return 'unit-manager';
    if (roles.includes(AppRole.CorporateChef)) return 'corporate-chef';
    if (roles.includes(AppRole.AdminSite)) return 'admin-site';
    if (roles.includes(AppRole.Storekeeper)) return 'storekeeper';
    if (roles.includes(AppRole.Chef)) return 'chef';
    throw new UnauthorizedException('User role is required');
  }

  private async resolveUserSite(user: UserSiteInput): Promise<AuthSiteContext> {
    if (user.roles?.includes(AppRole.Superadmin)) {
      return {};
    }

    const siteId = user.siteId ? String(user.siteId) : undefined;
    const assignedSites = (user.sites ?? [])
      .map((site) => site.trim())
      .filter(Boolean);
    if (siteId) {
      const site = await this.sites.findSummaryById(siteId);
      if (site) {
        return {
          site: site.code,
          siteId: site.id,
          siteName: site.name,
          sites: Array.from(new Set([site.code, ...assignedSites])),
        };
      }
    }

    const legacySite = assignedSites[0];
    if (legacySite) {
      const site = Array.from(
        (await this.sites.findSummariesByCodes([legacySite])).values(),
      )[0];
      if (site) {
        return {
          site: site.code,
          siteId: site.id,
          siteName: site.name,
          sites: assignedSites,
        };
      }

      return {
        site: legacySite,
        siteName: legacySite,
        sites: assignedSites,
      };
    }

    throw new UnauthorizedException('User site is required');
  }

  private async issueTokens(
    sub: string,
    name: string,
    email: string,
    roles: AppRole[],
    siteContext: AuthSiteContext,
  ) {
    const accessExpiresIn = resolveExpiresIn(
      this.config.get<string>('JWT_ACCESS_EXPIRES_IN'),
      '8h',
    );
    const refreshExpiresIn = resolveExpiresIn(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN'),
      '8h',
    );
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    const appRole = this.resolveAppRole(roles);
    const refreshTokenId = randomUUID();

    const accessToken = await this.jwt.signAsync(
      {
        sub,
        name,
        email,
        roles,
        appRole,
        site: siteContext.site,
        siteId: siteContext.siteId,
        siteName: siteContext.siteName,
        sites: siteContext.sites,
      },
      { expiresIn: accessExpiresIn },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub, jti: refreshTokenId },
      { secret: refreshSecret, expiresIn: refreshExpiresIn },
    );

    return { accessToken, refreshToken };
  }
}
