import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppRole } from '../auth/roles.constants';
import { DashboardAccessService } from './dashboard-access.service';
import { emptyDashboardPolicy } from './dashboard-access.policy';
import { UpdateDashboardAccessDto } from './dto/update-dashboard-access.dto';

const userId = '507f1f77bcf86cd799439011';
const query = { startDate: '2026-10-01', endDate: '2026-10-28' };
const setup = (
  records: object[] = [],
  roles = [AppRole.UnitManager],
  isActive = true,
) => {
  const user = { name: 'Manager', roles, sites: ['A'], isActive };
  const users = {
    findById: jest.fn().mockReturnValue({
      select: jest
        .fn()
        .mockReturnValue({ lean: jest.fn().mockResolvedValue(user) }),
    }),
  };
  const policies = {
    find: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(records) }),
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(emptyDashboardPolicy()),
    }),
  };
  const sites = { countDocuments: jest.fn().mockResolvedValue(0) };
  const getSuperadminAnalytics = jest.fn().mockResolvedValue({
    summary: {
      foodCostPercentage: 25,
      pax: 100,
      estimatedCost: 1000,
      estimatedRevenue: 4000,
      incompleteBatches: 0,
    },
    workflow: { approval: { approved: 2 }, storeRequest: { fulfilled: 2 } },
    trend: [
      {
        period: '2026-10-01',
        batches: 2,
        pax: 100,
        foodCostPercentage: 25,
        estimatedCost: 1000,
        estimatedRevenue: 4000,
        paxByClient: [{ client: 'A', pax: 100 }],
      },
    ],
    sites: [{ code: 'A', name: 'A' }],
    items: [{ estimatedCost: 1000 }],
    bySite: [{ estimatedCost: 1000 }],
  });
  const service = new DashboardAccessService(
    policies as never,
    users as never,
    sites as never,
    {} as never,
    { getSuperadminAnalytics } as never,
  );
  return { service, users, sites, policies, getSuperadminAnalytics };
};
const roleGrant = {
  ...emptyDashboardPolicy(),
  targetType: 'role',
  targetId: AppRole.UnitManager,
  dashboard: 'allow',
  components: [{ key: 'paxCard', decision: 'allow' }],
};

describe('Dashboard access enforcement', () => {
  it('saves a validated user override with its actor and returns the effective grant', async () => {
    const savedPolicy = {
      ...emptyDashboardPolicy(),
      targetType: 'user',
      targetId: userId,
      dashboard: 'allow' as const,
      siteMode: 'selected' as const,
      sites: ['B'],
      components: [{ key: 'paxCard' as const, decision: 'allow' as const }],
    };
    const { service, sites, policies } = setup([savedPolicy]);
    sites.countDocuments.mockResolvedValue(1);
    policies.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(savedPolicy),
    });
    const result = await service.saveSettings(
      'user',
      userId,
      { ...savedPolicy, sites: [' B '] },
      'admin-id',
    );
    expect(policies.findOneAndUpdate).toHaveBeenCalledWith(
      { targetType: 'user', targetId: userId },
      { $set: { ...savedPolicy, updatedBy: 'admin-id' } },
      { upsert: true, runValidators: true },
    );
    expect(result.effective).toMatchObject({
      dashboard: true,
      sites: ['B'],
      components: { paxCard: true, costCard: false },
    });
  });

  it('blocks unconfigured users, revoked users, and arbitrary site requests before querying analytics', async () => {
    for (const scenario of [
      setup(),
      setup([roleGrant], [AppRole.UnitManager], false),
    ]) {
      await expect(
        scenario.service.analytics(userId, query),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(scenario.getSuperadminAnalytics).not.toHaveBeenCalled();
    }
    const { service, getSuperadminAnalytics } = setup([roleGrant]);
    await expect(
      service.analytics(userId, { ...query, site: 'OTHER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getSuperadminAnalytics).not.toHaveBeenCalled();
    await expect(service.clientOptions(userId, 'OTHER')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('passes allowed sites to aggregation and redacts all financial and raw-detail payloads', async () => {
    const { service, getSuperadminAnalytics } = setup([roleGrant]);
    const result = await service.analytics(userId, query);
    expect(getSuperadminAnalytics).toHaveBeenCalledWith(query, ['A']);
    expect(result.summary).toEqual({
      foodCostPercentage: null,
      pax: 100,
      estimatedCost: null,
      estimatedRevenue: null,
      incompleteBatches: 0,
    });
    expect(result.workflow).toEqual({});
    expect(result.trend).toEqual([]);
    expect(result).not.toHaveProperty('items');
    expect(result).not.toHaveProperty('bySite');
  });

  it('allows a chart independently from its summary card without disclosing other chart values', async () => {
    const { service } = setup([
      { ...roleGrant, components: [{ key: 'paxChart', decision: 'allow' }] },
    ]);
    const result = await service.analytics(userId, query);
    expect(result.summary.pax).toBeNull();
    expect(result.trend[0]).toMatchObject({
      pax: 100,
      estimatedCost: null,
      estimatedRevenue: null,
      foodCostPercentage: null,
    });
  });

  it('rejects a selected-site policy without valid sites and prevents changing superadmin grants', async () => {
    const { service, policies } = setup();
    await expect(
      service.saveSettings(
        'user',
        userId,
        { ...emptyDashboardPolicy(), siteMode: 'selected', sites: [] },
        'actor',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveSettings(
        'user',
        userId,
        { ...emptyDashboardPolicy(), siteMode: 'selected', sites: ['MISSING'] },
        'actor',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveSettings(
        'role',
        'superadmin',
        emptyDashboardPolicy(),
        'actor',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(policies.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects unknown components, duplicate components, and malformed decisions at the DTO boundary', async () => {
    for (const components of [
      [{ key: 'unknown', decision: 'allow' }],
      [
        { key: 'paxCard', decision: 'allow' },
        { key: 'paxCard', decision: 'deny' },
      ],
      [{ key: 'paxCard', decision: 'yes' }],
    ]) {
      const dto = plainToInstance(UpdateDashboardAccessDto, {
        ...emptyDashboardPolicy(),
        components,
      });
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });
});
