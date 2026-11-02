import { RawMaterialsService } from './raw-materials.service';

describe('Shared IT catalogue', () => {
  it('updates a site price with a blank vendor without changing the global master price', async () => {
    const master = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              _id: 'product',
              productCode: 'IT002_N',
              productCodeNormalized: 'it002_n',
              name: 'Shared product',
              unitOfMeasures: 'KG',
            },
          ]),
        }),
      }),
      bulkWrite: jest.fn(),
    };
    const prices = {
      find: jest.fn().mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
      bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
    };
    const service = new RawMaterialsService(
      master as never,
      prices as never,
      {} as never,
      {} as never,
    );
    const result = await service.bulkUpdatePricesByProductCode([
      { productCode: 'IT002_N', site: 'SOKIT', price: 15000 },
    ]);
    expect(result).toMatchObject({
      mode: 'vendor',
      vendorPriceUpsertedCount: 1,
    });
    expect(master.bulkWrite).not.toHaveBeenCalled();
    const calls = prices.bulkWrite.mock.calls as unknown as Array<
      [Array<{ updateOne: { update: { $set: Record<string, unknown> } } }>]
    >;
    expect(calls[0][0][0].updateOne.update.$set).toMatchObject({
      site: 'SOKIT',
      price: 15000,
      vendor: 'NO VENDOR',
    });
  });

  it('lists products with no local price without exposing a foreign price or vendor', async () => {
    const material = {
      _id: 'product',
      productCode: 'IT002_N',
      name: 'Shared product',
      unitOfMeasures: 'KG',
      price: 99999,
      vendor: 'Foreign vendor',
    };
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([material]),
    };
    const model = {
      find: jest.fn().mockReturnValue(query),
      countDocuments: jest.fn().mockResolvedValue(1),
    };
    const prices = { distinct: jest.fn() };
    const service = new RawMaterialsService(
      model as never,
      prices as never,
      {} as never,
      {} as never,
    );
    const result = await service.findAll({
      page: 1,
      limit: 20,
      site: 'SOKIT',
      catalog: true,
    });
    expect(model.find).toHaveBeenCalledWith({ productCode: /^IT/i });
    expect(prices.distinct).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({
      productCode: 'IT002_N',
      name: 'Shared product',
      price: 0,
    });
    expect(result.items[0]).not.toHaveProperty('vendor');
  });

  it('keeps operational prices at the target site even when corporate reference sites are configured', async () => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    const prices = { find: jest.fn().mockReturnValue(query) };
    const sites = {
      findSummariesByCodes: jest
        .fn()
        .mockResolvedValue(
          new Map([['SOKIT', { code: 'SOKIT', name: 'Sokit Site' }]]),
        ),
      findMaterialSourceSites: jest.fn(),
    };
    const service = new RawMaterialsService(
      {} as never,
      prices as never,
      {} as never,
      sites as never,
    );
    await service.findVendorPrices({
      productCode: 'IT002_N',
      site: 'SOKIT',
      ownSiteOnly: true,
    });
    expect(sites.findMaterialSourceSites).not.toHaveBeenCalled();
    const calls = prices.find.mock.calls as unknown as Array<
      [{ productCodeNormalized: string; siteNormalized: { $in: string[] } }]
    >;
    const filter = calls[0][0];
    expect(filter.productCodeNormalized).toBe('it002_n');
    expect(filter.siteNormalized.$in).toContain('sokit');
    expect(filter.siteNormalized.$in).not.toContain('donggi');
  });
});
