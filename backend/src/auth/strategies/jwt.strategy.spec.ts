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
    const sites = {
      findSummariesByCodes: jest.fn().mockResolvedValue(new Map()),
      findSummaryById: jest.fn(),
      findApprovalSites: jest
        .fn()
        .mockResolvedValue([
          { code: 'SITE-001' },
          { code: 'SITE-002' },
          { code: 'CORP-OTHER' },
        ]),
    };
    return {
      strategy: new JwtStrategy(
        config as never,
        users as never,
        sites as never,
      ),
      users,
      sites,
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

    await expect(strategy.validate(payload)).resolves.toEqual({
      ...payload,
      corporateSite: false,
      approvalSites: undefined,
    });
    expect(users.touchLastActivity).toHaveBeenCalled();
  });

  it('includes corporate and operational approval sites only for a corporate chef at an active corporate site', async () => {
    const { strategy, sites } = makeStrategy(1);
    sites.findSummariesByCodes.mockResolvedValue(
      new Map([
        [
          'SITE-001',
          {
            code: 'SITE-001',
            name: 'Corporate Kitchen',
            isActive: true,
            siteFunction: 'corporate',
          },
        ],
      ]),
    );
    await expect(strategy.validate(payload)).resolves.toEqual(
      expect.objectContaining({
        corporateSite: true,
        approvalSites: ['SITE-001', 'SITE-002', 'CORP-OTHER'],
      }),
    );
    sites.findSummariesByCodes.mockResolvedValue(
      new Map([
        [
          'SITE-001',
          { code: 'SITE-001', isActive: true, siteFunction: 'operational' },
        ],
      ]),
    );
    await expect(
      strategy.validate({
        ...payload,
        corporateSite: true,
        approvalSites: ['UNAUTHORIZED'],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        corporateSite: false,
        approvalSites: undefined,
      }),
    );
  });

  it('does not grant corporate privileges to another role at the same site', async () => {
    const { strategy, sites } = makeStrategy(1);
    await expect(
      strategy.validate({
        ...payload,
        roles: [AppRole.Chef],
        corporateSite: true,
        approvalSites: ['UNAUTHORIZED'],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        corporateSite: false,
        approvalSites: undefined,
      }),
    );
    expect(sites.findApprovalSites).not.toHaveBeenCalled();
  });
});
