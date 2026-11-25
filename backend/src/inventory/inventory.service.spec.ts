import { ConflictException } from '@nestjs/common';
import type { ClientSession, Connection } from 'mongoose';
import { InventoryService } from './inventory.service';
import { Workbook } from 'exceljs';

describe('Inventory database prerequisites', () => {
  it.each([
    { actualQty: 5, expectedDelta: -1 },
    { actualQty: 6, expectedDelta: null },
  ])(
    'checks the net issue correction within the write session',
    async ({ actualQty, expectedDelta }) => {
      const material = {
        productCode: 'IT001',
        name: 'Rice',
        unitOfMeasures: 'KG',
      };
      const session = {} as ClientSession;
      const inSession = jest
        .fn()
        .mockResolvedValue([{ ...material, quantity: 1 }]);
      const issueUpdate = jest.fn().mockResolvedValue(undefined);
      const ledgerCreate = jest.fn().mockResolvedValue(undefined);
      const inventory = new InventoryService(
        {} as never,
        {
          findOne: () => ({
            session: () => ({ lean: () => Promise.resolve({}) }),
          }),
        } as never,
        {
          aggregate: () => ({ session: inSession }),
          create: ledgerCreate,
        } as never,
        {
          findOne: () => ({
            session: () => ({
              lean: () =>
                Promise.resolve({
                  lines: [{ ...material, quantity: 4 }],
                  revision: 1,
                }),
            }),
          }),
          updateOne: issueUpdate,
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      jest
        .spyOn(inventory, 'normalizeLines')
        .mockResolvedValue([{ ...material, quantity: actualQty }]);
      const write = inventory.recordIssue(
        'S001',
        'batch',
        '2026-11-18',
        ['menu'],
        [{ ...material, actualQty }],
        'Storekeeper',
        undefined,
        session,
      );
      if (expectedDelta === null) {
        await expect(write).rejects.toThrow('Insufficient stock for IT001');
        expect(issueUpdate).not.toHaveBeenCalled();
        expect(ledgerCreate).not.toHaveBeenCalled();
      } else {
        await expect(write).resolves.toBeUndefined();
        expect(ledgerCreate).toHaveBeenCalledWith(
          [
            expect.objectContaining({
              occurredAt: new Date('2026-11-17T17:00:00Z'),
              lines: [{ ...material, quantity: expectedDelta }],
            }),
          ],
          { session },
        );
      }
      expect(inSession).toHaveBeenCalledWith(session);
    },
  );

  it('saves a separate received date for each PO and rejects invalid dates', async () => {
    const workbook = new Workbook();
    workbook.addWorksheet('Sheet1').addRows([
      [
        'Display Name',
        'Order Lines/Product/Product Code',
        'Order Lines/Product',
        'Order Lines/Quantity',
        'Order Lines/Unit of Measure',
        'R',
      ],
      ['PO/1', 'IT001', 'Rice', 20, 'PCS', 18],
      ['PO/2', 'IT001', 'Rice', 10, 'KG', 8],
    ]);
    const session = {
      withTransaction: (work: () => Promise<unknown>) => work(),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const create = jest.fn().mockResolvedValue([]);
    const inventory = new InventoryService(
      { startSession: () => Promise.resolve(session) } as never,
      {
        findOneAndUpdate: () => ({ lean: () => Promise.resolve({}) }),
      } as never,
      {
        exists: () => ({ session: () => Promise.resolve(null) }),
        create,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findLookupsByNormalizedCodes: () =>
          Promise.resolve([{ productCode: 'IT001', unitOfMeasures: 'KG' }]),
      } as never,
      {} as never,
    );
    const normalize = jest
      .spyOn(inventory, 'normalizeLines')
      .mockResolvedValue([]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    const input = {
      quantities: '{"2":18,"3":8}',
      receivedDates: '{"PO/1":"2026-11-18","PO/2":"2026-11-19"}',
    };
    await inventory.confirmPurchaseOrders('S001', file, input, {
      id: 'u',
      name: 'User',
    });
    expect(normalize).toHaveBeenCalledWith(
      'S001',
      [{ productCode: 'IT001', unitOfMeasures: 'KG', quantity: 18 }],
      true,
      session,
      true,
    );
    expect(create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          reference: 'PO/1',
          occurredAt: new Date('2026-11-18T00:00:00+07:00'),
        }),
        expect.objectContaining({
          reference: 'PO/2',
          occurredAt: new Date('2026-11-19T00:00:00+07:00'),
        }),
      ],
      expect.anything(),
    );
    create.mockClear();
    for (const receivedDates of [
      '{}',
      '{"PO/1":"2026-02-30"}',
      '[]',
      'invalid',
    ]) {
      await expect(
        inventory.confirmPurchaseOrders(
          'S001',
          file,
          { ...input, receivedDates },
          { id: 'u', name: 'User' },
        ),
      ).rejects.toThrow();
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('uses master names and UOM in PO previews and identifies unknown product codes', async () => {
    const workbook = new Workbook();
    workbook.addWorksheet('Sheet1').addRows([
      [
        'Display Name',
        'Order Lines/Product/Product Code',
        'Order Lines/Product',
        'Order Lines/Quantity',
        'Order Lines/Unit of Measure',
        'R',
      ],
      ['PO/1', 'IT001', '[IT001] Excel name', 20, 'PCS', null],
      [null, 'IT002', '[IT002] Unknown Excel name', 1, 'KG', null],
    ]);
    const materials = {
      findLookupsByNormalizedCodes: jest.fn().mockResolvedValue([
        {
          productCode: 'it001',
          name: 'Master product name',
          unitOfMeasures: 'KG',
        },
      ]),
    };
    const inventory = new InventoryService(
      {} as never,
      {
        findOne: () => ({ lean: () => Promise.resolve({ active: true }) }),
      } as never,
      {
        find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      materials as never,
      {} as never,
    );
    const preview = await inventory.previewPurchaseOrders(
      'S001',
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    expect(preview.groups[0].rows.map((row) => row.name)).toEqual([
      'Master product name',
      'Item not found in SPICES master',
    ]);
    expect(preview.groups[0].rows.map((row) => row.unitOfMeasures)).toEqual([
      'KG',
      '-',
    ]);
    expect(materials.findLookupsByNormalizedCodes).toHaveBeenCalledWith([
      'IT001',
      'IT002',
    ]);
  });

  it('reports unsupported transactions as a conflict rather than application maintenance', async () => {
    const session = {
      withTransaction: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Standalone database'), { code: 20 }),
        ),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const connection = { startSession: jest.fn().mockResolvedValue(session) };
    const inventory = new InventoryService(
      connection as unknown as Connection,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      inventory.activate('S001', [], { id: 'user', name: 'User' }),
    ).rejects.toThrow(ConflictException);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
