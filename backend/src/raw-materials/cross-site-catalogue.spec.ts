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
      productCodeNormalized: 'it002_n',
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
    const priceQuery = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    const prices = { find: jest.fn().mockReturnValue(priceQuery) };
    const sites = {
      findSummariesByCodes: jest
        .fn()
        .mockResolvedValue(
          new Map([['SOKIT', { code: 'SOKIT', name: 'Sokit Site' }]]),
        ),
    };
    const service = new RawMaterialsService(
      model as never,
      prices as never,
      {} as never,
      sites as never,
    );
    const result = await service.findAll({
      page: 1,
      limit: 20,
      site: 'SOKIT',
      catalog: true,
    });
    expect(model.find).toHaveBeenCalledWith({ productCode: /^IT/i });
    const priceCalls: unknown = prices.find.mock.calls;
    const [priceFilter] = (priceCalls as Array<[unknown]>)[0];
    expect(priceFilter).toMatchObject({
      productCodeNormalized: { $in: ['it002_n'] },
      price: { $gt: 0 },
    });
    expect(
      (priceFilter as { siteNormalized: { $in: string[] } }).siteNormalized.$in,
    ).toContain('sokit');
    expect(result.items[0]).toMatchObject({
      productCode: 'IT002_N',
      name: 'Shared product',
      price: 0,
      sitePrice: 0,
      hasPrice: false,
    });
    expect(result.items[0]).not.toHaveProperty('vendor');
    priceQuery.lean.mockResolvedValueOnce([
      {
        productCodeNormalized: 'it002_n',
        unitOfMeasuresNormalized: 'kg',
        siteNormalized: 'sokit',
        price: 15000,
      },
      {
        productCodeNormalized: 'it002_n',
        unitOfMeasuresNormalized: 'kg',
        siteNormalized: 'sokit',
        price: 18000,
      },
      {
        productCodeNormalized: 'it002_n',
        unitOfMeasuresNormalized: 'ltr',
        siteNormalized: 'sokit',
        price: 99999,
      },
    ]);
    const pricedResult = await service.findAll({
      page: 1,
      limit: 20,
      site: 'SOKIT',
      catalog: true,
    });
    expect(pricedResult.items[0]).toMatchObject({
      hasPrice: true,
      sitePrice: 18000,
      price: 0,
    });
  });

  it('uses reference site priority for corporate catalogue prices', async () => {
    const material = {
      _id: 'product',
      productCode: 'IT002_N',
      productCodeNormalized: 'it002_n',
      name: 'Shared product',
      unitOfMeasures: 'KG',
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
    const priceQuery = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          productCodeNormalized: 'it002_n',
          unitOfMeasuresNormalized: 'kg',
          siteNormalized: 'b',
          price: 30000,
        },
        {
          productCodeNormalized: 'it002_n',
          unitOfMeasuresNormalized: 'kg',
          siteNormalized: 'a',
          price: 20000,
        },
      ]),
    };
    const prices = { find: jest.fn().mockReturnValue(priceQuery) };
    const sites = {
      findMaterialSourceSites: jest.fn().mockResolvedValue([
        { code: 'A', name: 'Reference A' },
        { code: 'B', name: 'Reference B' },
      ]),
    };
    const service = new RawMaterialsService(
      model as never,
      prices as never,
      {} as never,
      sites as never,
    );
    const input = {
      page: 1,
      limit: 20,
      site: 'CORP',
      catalog: true,
      useReferencePrices: true,
    };
    const result = await service.findAll(input);
    expect(sites.findMaterialSourceSites).toHaveBeenCalledWith('CORP');
    expect(result.items[0]).toMatchObject({ sitePrice: 20000, hasPrice: true });

    priceQuery.lean.mockResolvedValueOnce([
      {
        productCodeNormalized: 'it002_n',
        unitOfMeasuresNormalized: 'kg',
        siteNormalized: 'b',
        price: 30000,
      },
    ]);
    const fallbackResult = await service.findAll(input);
    expect(fallbackResult.items[0]).toMatchObject({
      sitePrice: 30000,
      hasPrice: true,
    });
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
