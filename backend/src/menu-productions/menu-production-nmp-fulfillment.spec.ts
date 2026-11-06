import { MenuProductionsService } from './menu-productions.service';

describe('NMP fulfillment', () => {
  it('matches different and repeated NMP ingredients to their own actual quantities', async () => {
    const menu = {
      _id: 'menu-1',
      site: 'SITE',
      productionDate: '2026-08-21',
      productionCode: 'MPR0081',
      approvalStatus: 'approved',
      storeRequestStatus: 'requested',
    };
    const model = {
      find: jest.fn().mockReturnValue({
        sort: () => ({ lean: () => Promise.resolve([menu]) }),
      }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const service = new MenuProductionsService(
      model as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const planned = [
      {
        productCode: 'NMP',
        name: 'Daging Kerbau',
        unitOfMeasures: 'KG',
        qty: 30,
      },
      { productCode: 'NMP', name: 'Dada Ayam', unitOfMeasures: 'KG', qty: 15 },
      { productCode: 'NMP', name: 'Dada Ayam', unitOfMeasures: 'KG', qty: 5 },
    ];
    Object.defineProperty(service, 'buildGroupedStoreRequestsFromMenus', {
      value: jest.fn().mockResolvedValue([
        {
          date: menu.productionDate,
          productionCode: menu.productionCode,
          summary: planned,
        },
      ]),
    });

    await service.fulfillStoreRequestBatch(
      {
        menuProductionIds: ['menu-1'],
        items: planned.map(({ qty, ...item }) => ({ ...item, actualQty: qty })),
      },
      'SITE',
      'Storekeeper',
    );

    expect(
      model.updateMany.mock.calls[0][1].$set.storeFulfillmentItems,
    ).toEqual(
      expect.arrayContaining(
        planned.map((item) =>
          expect.objectContaining({
            name: item.name,
            plannedQty: item.qty,
            actualQty: item.qty,
          }),
        ),
      ),
    );
  });
});
