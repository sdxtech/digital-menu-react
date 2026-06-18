import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
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
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';

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
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @Post('login')
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
  me(@Req() req: AuthenticatedRequest) {
    const { sub, name, email, roles, appRole, site, siteId, siteName } =
      req.user;
    return { id: sub, name, email, roles, appRole, site, siteId, siteName };
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
      throw new BadRequestException('Your current password entry is incorrect.');
    }

    return this.users.updatePassword(userId, dto.newPassword || '');
  }

  // 🌟 REVISED ENDPOINT: Intercepts tokens locally to run 100% firewall-free
  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: { email: string },
  ) {
    const user = await this.users.findByEmail(dto.email);
    
    if (!user) {
      return { 
        ok: true, 
        message: 'If that email exists in our system, a recovery link has been dispatched.' 
      };
    }

    const testToken = 'SECRET_TEST_TOKEN_123';

    // @ts-ignore
    await this.users.userModel.updateOne(
      { _id: user._id },
      { $set: { resetToken: testToken } }
    );

    try {
      // 📬 LOCAL DEV INTERCEPTOR: Completely bypasses outbound internet port restrictions
      console.log('\n==================================================');
      console.log('📬 [LOCAL DEV EMAIL INTERCEPTOR]');
      console.log(`A password reset link was requested for: ${dto.email}`);
      console.log('--------------------------------------------------');
      console.log('Click or copy this link into your browser to test the frontend form:');
      console.log(`👉 http://localhost:5173/reset-password?token=${testToken}`);
      console.log('==================================================\n');

    } catch (mailError) {
      console.error('❌ Local Logging Failure:', mailError);
    }
    
    return { 
      ok: true, 
      message: 'If that email exists in our system, a recovery link has been dispatched.' 
    };
  }

  @Post('reset-password')
  async resetPassword(
    @Body() dto: { token: string; newPassword?: string },
  ) {
    if (!dto.token) {
      throw new BadRequestException('A valid security recovery token must be provided.');
    }

    const user = await this.users.findByResetToken(dto.token);
    if (!user) {
      throw new BadRequestException('This recovery link is invalid or has expired.');
    }

    await this.users.updatePassword(user.id, dto.newPassword || '');
    await this.users.clearResetToken(user.id);

    return { 
      ok: true, 
      message: 'Password updated successfully.' 
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