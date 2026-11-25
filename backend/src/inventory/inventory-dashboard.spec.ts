import 'reflect-metadata';
import { InventoryDashboardQueryDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

describe('Inventory dashboard movement trend', () => {
  const range = {
    ...new InventoryDashboardQueryDto(),
    from: '2026-11-20',
    to: '2026-11-21',
  };

  function setup() {
    const aggregate = jest.fn().mockResolvedValue([
      {
        rows: [{ _id: '2026-11-20', stockIn: 5, stockOut: 2 }],
        totals: [{ stockIn: 5, stockOut: 2 }],
      },
    ]);
    const service = {
      entries: { aggregate },
    } as unknown as InventoryService;
    Object.setPrototypeOf(service, InventoryService.prototype);
    return { service, aggregate };
  }

  it('returns movement totals for all products alongside the top ten', async () => {
    const { service, aggregate } = setup();
    aggregate.mockResolvedValueOnce([
      {
        rows: [{ _id: 'IT001', stockIn: 5, stockOut: 2 }],
        totals: [{ stockIn: 15, stockOut: 8 }],
      },
    ]);
    await expect(service.dashboardTrend('S001', range)).resolves.toEqual({
      hasData: true,
      points: [],
      items: [{ productCode: 'IT001', stockIn: 5, stockOut: 2 }],
      totals: { stockIn: 15, stockOut: 8 },
    });
    expect(aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          $match: {
            site: 'S001',
            kind: { $ne: 'opening' },
            occurredAt: {
              $gte: new Date('2026-11-19T17:00:00Z'),
              $lte: new Date('2026-11-21T16:59:59.999Z'),
            },
          },
        },
      ]),
    );
    const [pipeline] = aggregate.mock.calls[0] as [
      Array<{
        $group?: { _id: string };
        $facet?: { rows: unknown[]; totals: unknown[] };
      }>,
    ];
    expect(pipeline.find((stage) => stage.$group)?.$group?._id).toBe(
      '$lines.productCode',
    );
    expect(JSON.stringify(pipeline)).not.toContain('unitOfMeasures');
    const facet = pipeline.find((stage) => stage.$facet)?.$facet;
    expect(facet?.rows).toContainEqual({ $sort: { movement: -1, _id: 1 } });
    expect(facet?.rows).toContainEqual({ $limit: 10 });
    expect(facet?.totals).toEqual([
      {
        $group: {
          _id: null,
          stockIn: { $sum: '$stockIn' },
          stockOut: { $sum: '$stockOut' },
        },
      },
    ]);
  });

  it('filters by product when an item is selected', async () => {
    const { service, aggregate } = setup();
    const result = await service.dashboardTrend('S001', {
      ...range,
      productCode: 'it001',
    });
    expect(result.points).toEqual([
      { date: '2026-11-20', stockIn: 5, stockOut: 2 },
      { date: '2026-11-21', stockIn: 0, stockOut: 0 },
    ]);
    expect(result.totals).toEqual({ stockIn: 5, stockOut: 2 });
    expect(aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          $match: {
            'lines.productCode': 'IT001',
          },
        },
      ]),
    );
  });

  it('rejects a blank product selection', async () => {
    const { service, aggregate } = setup();
    await expect(
      service.dashboardTrend('S001', { ...range, productCode: ' ' }),
    ).rejects.toThrow('Select an inventory item.');
    expect(aggregate).not.toHaveBeenCalled();
  });
});
