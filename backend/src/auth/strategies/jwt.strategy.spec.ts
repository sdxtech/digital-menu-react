import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { AppRole } from '../roles.constants';

describe('JwtStrategy session revocation', () => {
  const payload = {
    sub: 'user-1',
    name: 'Chef',
    email: 'chef@corp.test',
    roles: [AppRole.CorporateChef],
    site: 'SITE-001',
    sessionVersion: 1,
  };

  const makeStrategy = (sessionVersion: number) => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue('access-secret'),
      get: jest.fn().mockReturnValue('480'),
    };
    const users = {
      findByIdWithSessionState: jest.fn().mockResolvedValue({
        id: 'user-1',
        isActive: true,
        refreshTokenHash: 'current-refresh-hash',
        sessionVersion,
        lastActivityAt: new Date(),
      }),
      touchLastActivity: jest.fn(),
      setRefreshToken: jest.fn(),
    };
    return {
      strategy: new JwtStrategy(config as never, users as never),
      users,
    };
  };

  it('rejects an access token issued before a password change', async () => {
    const { strategy, users } = makeStrategy(2);

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(users.touchLastActivity).not.toHaveBeenCalled();
  });

  it('accepts an access token issued after the password change', async () => {
    const { strategy, users } = makeStrategy(1);

    await expect(strategy.validate(payload)).resolves.toEqual(payload);
    expect(users.touchLastActivity).toHaveBeenCalled();
  });
});
