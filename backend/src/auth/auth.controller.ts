import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthThrottleGuard } from './guards/auth-throttle.guard';
import type { AuthenticatedRequest } from './types/authenticated-request.type';
import { UsersService } from '../users/users.service';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SitesService } from '../sites/sites.service';

const REFRESH_COOKIE_NAME = 'dm_refresh_token';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly sites: SitesService,
  ) {}

  @Post('register')
  @SetMetadata('isPublic', true)
  @UseGuards(AuthThrottleGuard)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.register(dto.name, dto.email, dto.password);
    this.setRefreshCookie(res, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @Post('login')
  @SetMetadata('isPublic', true)
  @UseGuards(AuthThrottleGuard)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.login(dto.email, dto.password);
    this.setRefreshCookie(res, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @Post('refresh')
  @UseGuards(AuthThrottleGuard)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = this.readCookie(req, REFRESH_COOKIE_NAME);
    const refreshToken = dto.refreshToken ?? cookieToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const tokens = await this.auth.refresh(refreshToken);
    this.setRefreshCookie(res, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.users.setRefreshToken(req.user.sub, null);
    this.clearRefreshCookie(res);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthenticatedRequest) {
    const { sub, name, email, roles, appRole, site, siteId, siteName, sites } =
      req.user;
    const storedUser = await this.users.findById(sub);
    const storedPrimarySite = storedUser?.siteId
      ? await this.sites.findById(String(storedUser.siteId))
      : null;
    const primarySummary = storedPrimarySite
      ? this.sites.toSummary(storedPrimarySite)
      : undefined;
    const effectiveSite = primarySummary?.code ?? site;
    const assignedSites = Array.from(
      new Set([
        ...(effectiveSite ? [effectiveSite] : []),
        ...(storedUser?.sites?.length ? storedUser.sites : sites ?? []),
      ]),
    );
    const siteSummaries = assignedSites?.length
      ? await this.sites.findSummariesByCodes(assignedSites)
      : new Map();
    const siteOptions = (assignedSites ?? []).map((code) => {
      const summary = siteSummaries.get(code);
      return { code, name: summary?.name ?? code };
    });
    return {
      id: sub,
      name,
      email,
      roles,
      appRole,
      site: effectiveSite,
      siteId: primarySummary?.id ?? siteId,
      siteName: primarySummary?.name ?? siteName,
      sites: assignedSites,
      siteOptions,
    };
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: { name: string },
  ) {
    const userId = req.user.sub;
    return this.users.updateById(userId, { name: dto.name });
  }

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  async updatePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: { currentPassword?: string; newPassword?: string },
  ) {
    const userId = req.user.sub;

    const user = await this.users.findByEmail(req.user.email, true);
    if (!user) throw new NotFoundException('User account missing.');

    const isCurrentMatch = await bcrypt.compare(
      dto.currentPassword || '',
      user.passwordHash,
    );
    if (!isCurrentMatch) {
      throw new BadRequestException(
        'Your current password entry is incorrect.',
      );
    }

    return this.users.updatePassword(userId, dto.newPassword || '');
  }

  @Post('forgot-password')
  @SetMetadata('isPublic', true)
  @UseGuards(AuthThrottleGuard)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const user = await this.users.findByEmail(dto.email);

    if (user && user.isActive !== false) {
      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      const appBaseUrl = this.config.getOrThrow<string>('APP_BASE_URL');
      const resetUrl = `${appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;

      await this.users.setPasswordResetToken(user.id, tokenHash, expiresAt);
      try {
        await this.mail.enqueue({
          to: user.email,
          subject: 'Reset your Food Recipe System password',
          text: `Use this link to reset your password within 30 minutes: ${resetUrl}`,
          html: `<p>A password reset was requested for your Food Recipe System account.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
          category: 'password-reset',
          deduplicationKey: `password-reset-${user.id}-${tokenHash}`,
        });
      } catch (error) {
        this.logger.error(
          `Failed to enqueue password reset email: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      ok: true,
      message:
        'If that email exists in our system, a recovery link has been dispatched.',
    };
  }

  @Post('reset-password')
  @SetMetadata('isPublic', true)
  @UseGuards(AuthThrottleGuard)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const user = await this.users.consumePasswordResetToken(tokenHash);
    if (!user) {
      throw new BadRequestException(
        'This recovery link is invalid or has expired.',
      );
    }

    await this.users.updatePassword(user.id, dto.newPassword);
    await this.users.setRefreshToken(user.id, null);

    return {
      ok: true,
      message: 'Password updated successfully.',
    };
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    const secure = this.config.get<string>('NODE_ENV') === 'production';
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/auth',
    });
  }

  private clearRefreshCookie(res: Response) {
    const secure = this.config.get<string>('NODE_ENV') === 'production';
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/auth',
    });
  }

  private readCookie(req: Request, name: string) {
    const rawCookie = req.headers.cookie;
    if (!rawCookie) return undefined;

    const parts = rawCookie.split(';');
    for (const part of parts) {
      const [rawKey, ...rawValue] = part.trim().split('=');
      if (rawKey !== name) continue;
      const joinedValue = rawValue.join('=').trim();
      if (!joinedValue) return undefined;
      return decodeURIComponent(joinedValue);
    }
    return undefined;
  }
}
