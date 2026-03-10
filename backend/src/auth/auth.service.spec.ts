import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { AppRole } from './roles.constants';

describe('AuthService', () => {
  const env = {
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    AUTH_IDLE_TIMEOUT_MINUTES: '30',
  };

  const makeConfig = () => ({
    get: jest.fn((key: string) => env[key as keyof typeof env]),
    getOrThrow: jest.fn((key: string) => {
      const value = env[key as keyof typeof env];
      if (!value) throw new Error(`Missing ${key}`);
      return value;
    }),
  });

  const makeUsers = () => ({
    create: jest.fn(),
    findByEmail: jest.fn(),
    findByIdWithRefreshToken: jest.fn(),
    setRefreshToken: jest.fn(),
  });

  const makeJwt = () => ({
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  });

  it('rotates refresh token on refresh', async () => {
    const users = makeUsers();
    const jwt = makeJwt();
    const config = makeConfig();
    const service = new AuthService(
      users as never,
      jwt as never,
      config as never,
    );

    const refreshToken = 'old-refresh-token';
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    users.findByIdWithRefreshToken.mockResolvedValue({
      id: 'user-1',
      name: 'Chef',
      email: 'chef@corp.test',
      isActive: true,
      roles: [AppRole.Chef],
      sites: ['A1'],
      lastActivityAt: new Date(),
      refreshTokenHash,
    });
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    jwt.signAsync
      .mockResolvedValueOnce('new-access-token')
      .mockResolvedValueOnce('new-refresh-token');

    const result = await service.refresh(refreshToken);

    expect(result).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
    expect(users.setRefreshToken).toHaveBeenCalledWith(
      'user-1',
      'new-refresh-token',
    );
  });

  it('rejects refresh token when hash does not match', async () => {
    const users = makeUsers();
    const jwt = makeJwt();
    const config = makeConfig();
    const service = new AuthService(
      users as never,
      jwt as never,
      config as never,
    );

    users.findByIdWithRefreshToken.mockResolvedValue({
      id: 'user-1',
      name: 'Chef',
      email: 'chef@corp.test',
      isActive: true,
      roles: [AppRole.Chef],
      sites: ['A1'],
      lastActivityAt: new Date(),
      refreshTokenHash: await bcrypt.hash('another-token', 10),
    });
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });

    await expect(service.refresh('wrong-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.setRefreshToken).not.toHaveBeenCalled();
  });

  it('revokes session when refresh token is idle-timed out', async () => {
    const users = makeUsers();
    const jwt = makeJwt();
    const config = makeConfig();
    const service = new AuthService(
      users as never,
      jwt as never,
      config as never,
    );

    const refreshToken = 'old-refresh-token';
    users.findByIdWithRefreshToken.mockResolvedValue({
      id: 'user-1',
      name: 'Chef',
      email: 'chef@corp.test',
      isActive: true,
      roles: [AppRole.Chef],
      sites: ['A1'],
      lastActivityAt: new Date(Date.now() - 31 * 60 * 1000),
      refreshTokenHash: await bcrypt.hash(refreshToken, 10),
    });
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });

    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.setRefreshToken).toHaveBeenCalledWith('user-1', null);
  });

  it('stores refresh token hash on login', async () => {
    const users = makeUsers();
    const jwt = makeJwt();
    const config = makeConfig();
    const service = new AuthService(
      users as never,
      jwt as never,
      config as never,
    );

    users.findByEmail.mockResolvedValue({
      id: 'user-1',
      name: 'Chef',
      email: 'chef@corp.test',
      passwordHash: await bcrypt.hash('secret-pass', 10),
      isActive: true,
      roles: [AppRole.Chef],
      sites: ['A1'],
    });
    jwt.signAsync
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');

    const result = await service.login('chef@corp.test', 'secret-pass');

    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(users.setRefreshToken).toHaveBeenCalledWith(
      'user-1',
      'refresh-token',
    );
  });
});
