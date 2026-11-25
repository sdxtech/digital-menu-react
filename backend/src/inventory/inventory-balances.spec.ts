import 'reflect-metadata';
import { validate } from 'class-validator';
import type { PipelineStage } from 'mongoose';
import { InventoryQueryDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

describe('Inventory closing balance', () => {
  it('carries earlier balances forward and applies daily changes in date order', async () => {
    const aggregate = jest
      .fn<Promise<unknown[]>, [PipelineStage[]]>()
      .mockResolvedValue([
        {
          items: [
            {
              productCode: 'IT001',
              name: 'Rice',
              unitOfMeasures: 'KG',
              quantity: 7,
              dailyDeltas: [
                { day: '2026-11-18', quantity: -5 },
                { day: '2026-11-14', quantity: 10 },
                { day: '2026-11-16', quantity: 5 },
                { day: '2026-11-16', quantity: -3 },
              ],
            },
          ],
          total: [{ count: 1 }],
        },
      ]);
    const service = { entries: { aggregate } } as unknown as InventoryService;
    Object.setPrototypeOf(service, InventoryService.prototype);
    const result = await service.balances('S001', {
      ...new InventoryQueryDto(),
      from: '2026-11-15',
      to: '2026-11-18',
    });
    expect(result.dates).toEqual([
      '2026-11-18',
      '2026-11-17',
      '2026-11-16',
      '2026-11-15',
    ]);
    expect(result.items[0]).toEqual({
      productCode: 'IT001',
      name: 'Rice',
      unitOfMeasures: 'KG',
      quantity: 7,
      quantities: {
        '2026-11-15': 10,
        '2026-11-16': 12,
        '2026-11-17': 12,
        '2026-11-18': 7,
      },
    });
    expect(aggregate.mock.calls[0][0]).toContainEqual({
      $match: {
        site: 'S001',
        occurredAt: { $lte: new Date('2026-11-18T16:59:59.999Z') },
      },
    });
  });

  it('includes zero balances before the first movement and keeps negative quantities', async () => {
    const aggregate = jest
      .fn<Promise<unknown[]>, [PipelineStage[]]>()
      .mockResolvedValue([
        {
          items: [
            {
              productCode: 'IT001',
              name: 'Rice',
              unitOfMeasures: 'KG',
              quantity: -0.3,
              dailyDeltas: [{ day: '2026-11-18', quantity: -0.1 - 0.2 }],
            },
          ],
          total: [{ count: 1 }],
        },
      ]);
    const service = { entries: { aggregate } } as unknown as InventoryService;
    Object.setPrototypeOf(service, InventoryService.prototype);
    const result = await service.balances('S001', {
      ...new InventoryQueryDto(),
      from: '2026-11-17',
      to: '2026-11-18',
    });
    expect(result.items[0]).toMatchObject({
      quantities: { '2026-11-17': 0, '2026-11-18': -0.3 },
    });
  });

  it.each([
    { from: '2026-11-18' },
    { from: '2026-11-18', to: '2026-11-17' },
    { from: '2025-01-01', to: '2026-11-18' },
    { from: '2026-11-18', to: '2026-11-18', asOf: '2026-11-18' },
  ])(
    'rejects incomplete, reversed, oversized or mixed ranges',
    async (range) => {
      const aggregate = jest.fn();
      await expect(
        InventoryService.prototype.balances.call(
          { entries: { aggregate } } as unknown as InventoryService,
          'S001',
          { ...new InventoryQueryDto(), ...range },
        ),
      ).rejects.toThrow();
      expect(aggregate).not.toHaveBeenCalled();
    },
  );

  it('limits entries to the end of the selected day in WIB', async () => {
    const aggregate = jest
      .fn<Promise<unknown[]>, [PipelineStage[]]>()
      .mockResolvedValue([{ items: [], total: [] }]);
    const service = { entries: { aggregate } } as unknown as InventoryService;
    Object.setPrototypeOf(service, InventoryService.prototype);
    await InventoryService.prototype.balances.call(service, 'S001', {
      ...new InventoryQueryDto(),
      asOf: '2026-11-18',
    });
    expect(aggregate.mock.calls[0][0]).toContainEqual({
      $match: {
        site: 'S001',
        occurredAt: { $lte: new Date('2026-11-18T16:59:59.999Z') },
      },
    });
  });

  it('includes all entries when the date is cleared', async () => {
    const aggregate = jest
      .fn<Promise<unknown[]>, [PipelineStage[]]>()
      .mockResolvedValue([{ items: [], total: [] }]);
    const service = { entries: { aggregate } } as unknown as InventoryService;
    Object.setPrototypeOf(service, InventoryService.prototype);
    await InventoryService.prototype.balances.call(
      service,
      'S001',
      new InventoryQueryDto(),
    );
    expect(aggregate.mock.calls[0][0][0]).toEqual({ $match: { site: 'S001' } });
  });

  it.each(['2026-02-30', '2026-11-18T12:00:00Z', 'invalid'])(
    'rejects invalid stock date %s',
    async (asOf) => {
      const errors = await validate(
        Object.assign(new InventoryQueryDto(), { asOf }),
      );
      expect(errors.some((error) => error.property === 'asOf')).toBe(true);
    },
  );

  it('accepts a valid date without requiring one', async () => {
    expect(
      await validate(
        Object.assign(new InventoryQueryDto(), { asOf: '2026-11-18' }),
      ),
    ).toHaveLength(0);
    expect(await validate(new InventoryQueryDto())).toHaveLength(0);
  });
});
