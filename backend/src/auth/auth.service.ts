import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { resolveExpiresIn } from './jwt.utils';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(name: string, email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.users.create({ name, email, passwordHash });

    return this.issueTokens(user.id, user.email, user.roles);
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email, true);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('User disabled');

    return this.issueTokens(user.id, user.email, user.roles);
  }

  async refresh(refreshToken: string) {
    try {
      const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET');
      const payload = await this.jwt.verifyAsync<{ sub: string }>(refreshToken, {
        secret: refreshSecret,
      });

      const user = await this.users.findById(payload.sub);
      if (!user || !user.isActive) throw new UnauthorizedException('Invalid refresh token');

      // TODO: store hashed refresh tokens with allowlist for rotation/revocation.
      return this.issueTokens(user.id, user.email, user.roles);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async issueTokens(sub: string, email: string, roles: string[]) {
    const accessExpiresIn = resolveExpiresIn(
      this.config.get<string>('JWT_ACCESS_EXPIRES_IN'),
      '15m',
    );
    const refreshExpiresIn = resolveExpiresIn(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN'),
      '7d',
    );
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET');

    const accessToken = await this.jwt.signAsync(
      { sub, email, roles },
      { expiresIn: accessExpiresIn },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub },
      { secret: refreshSecret, expiresIn: refreshExpiresIn },
    );

    return { accessToken, refreshToken };
  }
}
