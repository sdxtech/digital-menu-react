import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthThrottleGuard } from './guards/auth-throttle.guard';
import type { AuthenticatedRequest } from './types/authenticated-request.type';
import { UsersService } from '../users/users.service';
import type { Request, Response } from 'express';

const REFRESH_COOKIE_NAME = 'dm_refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @UseGuards(AuthThrottleGuard)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.register(dto.name, dto.email, dto.password);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post('login')
  @UseGuards(AuthThrottleGuard)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.login(dto.email, dto.password);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post('refresh')
  @UseGuards(AuthThrottleGuard)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = this.readCookie(req, REFRESH_COOKIE_NAME);
    const refreshToken = cookieToken ?? dto.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const tokens = await this.auth.refresh(refreshToken);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
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
  me(@Req() req: AuthenticatedRequest) {
    const { sub, name, email, roles, appRole, site } = req.user;
    // BACKEND LOGIC: appRole is derived in auth service and returned here.
    return { id: sub, name, email, roles, appRole, site };
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
