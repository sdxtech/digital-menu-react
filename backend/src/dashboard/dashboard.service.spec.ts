import { DashboardService } from './dashboard.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('DashboardService', () => {
  const makeModel = () => ({
    countDocuments: jest.fn().mockResolvedValue(0),
  });

  it('excludes soft-deleted pending recipes from the superadmin summary', async () => {
    const menuProductionModel = makeModel();
    const userModel = makeModel();
    const siteModel = makeModel();
    const recipeModel = makeModel();

    const service = new DashboardService(
      menuProductionModel as never,
      userModel as never,
      siteModel as never,
      recipeModel as never,
      {} as never,
    );

    await service.getSuperadminSummary();

    expect(recipeModel.countDocuments).toHaveBeenCalledWith({
      approvalStatus: 'pending',
      deletedAt: { $exists: false },
    });
  });
});

describe('Superadmin analytics', () => {
  const menu = (overrides = {}) => ({
    id: 'menu-1',
    clientId: 'CLIENT-A',
    clientName: 'Client A',
    sellingQuantity: 100,
    sellingPricePerPax: 100,
    estimatedCost: 2000,
    approvalStatus: 'approved',
    storeRequestStatus: 'requested',
    ...overrides,
  });
  const group = (overrides = {}) => ({
    site: 'S01',
    date: '2026-10-01',
    productionCode: 'MPR001',
    items: [menu(), menu({ id: 'menu-2', estimatedCost: 3000 })],
    ...overrides,
  });
  const setup = (groups = [group()]) => {
    const buildAnalyticsProductionGroups = jest.fn().mockResolvedValue(groups);
    const siteModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            lean: jest
              .fn()
              .mockResolvedValue([{ code: 'S01', name: 'Site A' }]),
          }),
        }),
      }),
    };
    const service = new DashboardService(
      {} as never,
      {} as never,
      siteModel as never,
      {} as never,
      { buildAnalyticsProductionGroups } as never,
    );
    return { service, buildAnalyticsProductionGroups };
  };
  const query: AnalyticsQueryDto = {
    startDate: '2026-10-01',
    endDate: '2026-10-02',
  };

  it('passes client selection to the production query for all analytics metrics', async () => {
    const { service, buildAnalyticsProductionGroups } = setup();
    const result = await service.getSuperadminAnalytics({
      ...query,
      site: 'S01',
      clientId: ' KTB ',
    });
    expect(buildAnalyticsProductionGroups).toHaveBeenCalledWith(
      query.startDate,
      query.endDate,
      'S01',
      'KTB',
    );
    expect(result.summary.approvedBatches).toBe(1);
    expect(result.workflow.totalBatches).toBe(1);
  });

  it('counts batch sales once and sums the costs of every menu', async () => {
    const { service, buildAnalyticsProductionGroups } = setup();
    const result = await service.getSuperadminAnalytics({
      ...query,
      site: 'S01',
    });
    expect(buildAnalyticsProductionGroups).toHaveBeenCalledWith(
      query.startDate,
      query.endDate,
      'S01',
      undefined,
    );
    expect(result.summary).toEqual({
      pax: 100,
      estimatedCost: 5000,
      estimatedRevenue: 10000,
      foodCostPercentage: 50,
      approvedBatches: 1,
      incompleteBatches: 0,
    });
    expect(result.items).toHaveLength(1);
    expect(result.bySite[0]).toMatchObject({
      site: 'S01',
      pax: 100,
      estimatedCost: 5000,
    });
    expect(result.trend[1]).toMatchObject({
      period: '2026-10-02',
      batches: 0,
      foodCostPercentage: null,
      paxByClient: [],
    });
  });

  it.each(['daily', 'weekly', 'monthly'] as const)(
    'aggregates pax per client once per batch for %s charts, independently of pagination',
    async (interval) => {
      const { service } = setup([
        group(),
        group({
          date: '2026-10-02',
          productionCode: 'MPR002',
          items: [menu({ sellingQuantity: 50 })],
        }),
        group({
          productionCode: 'MPR003',
          items: [
            menu({
              clientId: 'CLIENT-B',
              clientName: 'Client B',
              sellingQuantity: 40,
            }),
          ],
        }),
        group({
          productionCode: 'MPR004',
          items: [
            menu({
              clientId: 'CLIENT-B',
              clientName: 'Client B',
              approvalStatus: 'pending',
            }),
          ],
        }),
      ]);
      const result = await service.getSuperadminAnalytics({
        ...query,
        interval,
        limit: 1,
      });
      expect(result.items).toHaveLength(1);
      const totals = new Map<string, number>();
      for (const point of result.trend) {
        expect(
          point.paxByClient.reduce((sum, client) => sum + (client.pax ?? 0), 0),
        ).toBe(point.pax);
        for (const client of point.paxByClient) {
          totals.set(
            client.client,
            (totals.get(client.client) ?? 0) + (client.pax ?? 0),
          );
        }
      }
      expect([...totals]).toEqual([
        ['Client A', 150],
        ['Client B', 40],
      ]);
      expect(result.trend).toHaveLength(interval === 'daily' ? 2 : 1);
    },
  );

  it('keeps clients with the same name separate by client code', async () => {
    const { service } = setup([
      group(),
      group({
        productionCode: 'MPR002',
        items: [menu({ clientId: 'CLIENT-B' })],
      }),
    ]);
    const result = await service.getSuperadminAnalytics(query);
    expect(result.trend[0].paxByClient).toHaveLength(2);
    expect(
      new Set(result.trend[0].paxByClient.map((client) => client.clientKey))
        .size,
    ).toBe(2);
    expect(result.trend[0].paxByClient.map((client) => client.pax)).toEqual([
      100, 100,
    ]);
  });

  it('retains legacy, unassigned, and mixed-client batches without duplicating their pax', async () => {
    const { service } = setup([
      group({ items: [menu({ clientId: undefined })] }),
      group({
        productionCode: 'MPR002',
        items: [menu({ clientId: undefined, clientName: undefined })],
      }),
      group({
        productionCode: 'MPR003',
        items: [menu(), menu({ clientId: 'CLIENT-B', clientName: 'Client B' })],
      }),
    ]);
    const result = await service.getSuperadminAnalytics(query);
    expect(
      result.trend[0].paxByClient.map(({ client, pax }) => ({ client, pax })),
    ).toEqual([
      { client: 'Client A', pax: 100 },
      { client: 'Unassigned client', pax: 100 },
      { client: 'Client A, Client B', pax: 100 },
    ]);
    expect(result.trend[0].pax).toBe(300);
  });

  it('excludes partially approved and returned batches from analytics while counting their workflow', async () => {
    const { service } = setup([
      group(),
      group({
        productionCode: 'MPR002',
        items: [
          menu(),
          menu({
            approvalStatus: 'pending',
            storeRequestStatus: 'not-requested',
          }),
        ],
      }),
      group({
        productionCode: 'MPR003',
        items: [
          menu({
            approvalStatus: 'rejected',
            storeRequestStatus: 'not-requested',
          }),
        ],
      }),
      group({
        productionCode: 'MPR004',
        items: [
          menu({
            approvalStatus: 'pending',
            sellingQuantity: undefined,
            storeRequestStatus: 'not-requested',
          }),
        ],
      }),
    ]);
    const result = await service.getSuperadminAnalytics(query);
    expect(result.summary.approvedBatches).toBe(1);
    expect(result.workflow.approval).toEqual({
      approved: 1,
      submitted: 1,
      returned: 1,
      pendingSales: 1,
    });
    expect(result.workflow.storeRequest).toEqual({
      requested: 1,
      mixed: 1,
      notRequested: 2,
      fulfilled: 0,
      cancelled: 0,
    });
  });

  it('calculates combined percentages from total cost and revenue across sites', async () => {
    const { service } = setup([
      group({
        items: [
          menu({
            sellingQuantity: 1,
            sellingPricePerPax: 100,
            estimatedCost: 50,
          }),
        ],
      }),
      group({
        site: 'S02',
        productionCode: 'MPR002',
        items: [
          menu({
            sellingQuantity: 4,
            sellingPricePerPax: 100,
            estimatedCost: 100,
          }),
        ],
      }),
    ]);
    const result = await service.getSuperadminAnalytics(query);
    expect(result.summary.foodCostPercentage).toBe(30);
    expect(result.bySite.map((site) => site.foodCostPercentage)).toEqual([
      50, 25,
    ]);
    expect(result.sites).toContainEqual({ code: 'S02', name: 'S02' });
  });

  it('keeps missing costs and inconsistent batch sales visible instead of treating them as zero', async () => {
    const { service } = setup([
      group({
        items: [
          menu(),
          menu({ sellingQuantity: 200, estimatedCost: undefined }),
        ],
      }),
    ]);
    const result = await service.getSuperadminAnalytics(query);
    expect(result.summary).toMatchObject({
      pax: null,
      estimatedCost: null,
      estimatedRevenue: null,
      foodCostPercentage: null,
      incompleteBatches: 1,
    });
    expect(result.items[0].sellingPricePerPax).toBeNull();
    expect(result.trend[0].paxByClient[0].pax).toBeNull();
  });

  it('shows zero sales with no food cost percentage', async () => {
    const { service } = setup([
      group({ items: [menu({ sellingQuantity: 0 })] }),
    ]);
    const result = await service.getSuperadminAnalytics(query);
    expect(result.summary).toMatchObject({
      pax: 0,
      estimatedRevenue: 0,
      foodCostPercentage: null,
      incompleteBatches: 0,
    });
  });

  it('groups weekly periods by Monday and monthly periods by calendar month', async () => {
    const { service } = setup([
      group(),
      group({ date: '2026-10-05', productionCode: 'MPR002' }),
    ]);
    const weekly = await service.getSuperadminAnalytics({
      ...query,
      endDate: '2026-10-05',
      interval: 'weekly',
    });
    expect(weekly.trend.map((point) => [point.period, point.batches])).toEqual([
      ['2026-09-28', 1],
      ['2026-10-05', 1],
    ]);
    const monthly = await service.getSuperadminAnalytics({
      ...query,
      endDate: '2026-10-05',
      interval: 'monthly',
    });
    expect(monthly.trend).toHaveLength(1);
    expect(monthly.trend[0]).toMatchObject({
      period: '2026-10',
      pax: 200,
      estimatedCost: 10000,
      estimatedRevenue: 20000,
      foodCostPercentage: 50,
    });
  });

  it('paginates records without truncating chart or summary totals', async () => {
    const { service } = setup([group(), group({ productionCode: 'MPR002' })]);
    const result = await service.getSuperadminAnalytics({
      ...query,
      limit: 1,
      page: 2,
    });
    expect(result.items[0].productionCode).toBe('MPR002');
    expect(result.summary.approvedBatches).toBe(2);
    expect(result.totalPages).toBe(2);
  });

  it('handles empty selections and rejects impossible, reversed, or excessive date ranges', async () => {
    const { service } = setup([]);
    const result = await service.getSuperadminAnalytics(query);
    expect(result.summary).toMatchObject({
      approvedBatches: 0,
      pax: 0,
      foodCostPercentage: null,
    });
    await expect(
      service.getSuperadminAnalytics({ ...query, startDate: '2026-02-30' }),
    ).rejects.toThrow('Invalid production date');
    await expect(
      service.getSuperadminAnalytics({ ...query, endDate: '2026-09-01' }),
    ).rejects.toThrow('date range');
    await expect(
      service.getSuperadminAnalytics({ ...query, startDate: '2025-01-01' }),
    ).rejects.toThrow('date range');
  });

  it('validates interval, dates and pagination at the API boundary', async () => {
    const invalid = plainToInstance(AnalyticsQueryDto, {
      startDate: 'bad',
      endDate: 'bad',
      interval: 'yearly',
      page: '0',
      limit: '101',
    });
    expect(
      (await validate(invalid)).map((error) => error.property).sort(),
    ).toEqual(['endDate', 'interval', 'limit', 'page', 'startDate']);
    const valid = plainToInstance(AnalyticsQueryDto, {
      ...query,
      interval: 'weekly',
      page: '1',
      limit: '25',
    });
    expect(await validate(valid)).toEqual([]);
  });
});
