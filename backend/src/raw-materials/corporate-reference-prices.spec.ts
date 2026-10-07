import { RawMaterialsService } from './raw-materials.service';

describe('Corporate reference material prices', () => {
  const sourceSites = ['A', 'B'].map((code) => ({
    code,
    name: `Jakarta ${code}`,
  }));
  const price = (
    site: string,
    vendor: string,
    unitOfMeasures: string,
    amount?: number,
  ) => ({
    productCodeNormalized: 'it001',
    site,
    siteNormalized: site.toLowerCase(),
    vendor,
    vendorNormalized: vendor.toLowerCase(),
    unitOfMeasures,
    price: amount,
  });
  const makeService = (records: unknown[]) => {
    const lean = jest.fn().mockResolvedValue(records);
    const vendorModel = {
      find: jest.fn().mockReturnValue({
        sort: jest
          .fn()
          .mockReturnValue({ limit: jest.fn().mockReturnValue({ lean }) }),
      }),
      distinct: jest.fn().mockResolvedValue(['it001', 'it002']),
    };
    const sites = {
      findMaterialSourceSites: jest.fn().mockResolvedValue(sourceSites),
    };
    return {
      service: new RawMaterialsService(
        {} as never,
        vendorModel as never,
        {} as never,
        sites as never,
      ),
      vendorModel,
    };
  };

  it('uses priority rather than cheapest or newest across sites', async () => {
    const { service } = makeService([
      price('B', 'B Vendor', 'KG', 5),
      price('A', 'A Vendor', 'KG', 20),
    ]);
    const result = await service.findVendorPrices({
      productCode: 'IT001',
      site: 'CORP',
    });
    expect(result).toEqual([
      expect.objectContaining({
        vendor: 'A Vendor',
        price: 20,
        priceSourceSite: 'A',
        priceSourceSiteName: 'Jakarta A',
      }),
    ]);
  });

  it('falls back for each unit when the primary price is missing or invalid', async () => {
    const { service } = makeService([
      price('A', 'A Vendor', 'KG'),
      price('B', 'B Vendor', 'KG', 5),
      price('A', 'A Vendor', 'PCS', 0),
      price('B', 'B Vendor', 'PCS', 10),
    ]);
    const result = await service.findVendorPrices({
      productCode: 'IT001',
      site: 'CORP',
    });
    expect(result).toEqual([
      expect.objectContaining({
        unitOfMeasures: 'KG',
        priceSourceSite: 'B',
        price: 5,
      }),
      expect.objectContaining({
        unitOfMeasures: 'PCS',
        priceSourceSite: 'A',
        price: 0,
      }),
    ]);
  });

  it('cannot bypass reference priority by filtering to a backup vendor', async () => {
    const { service } = makeService([
      price('A', 'A Vendor', 'KG', 20),
      price('B', 'B Vendor', 'KG', 5),
    ]);
    await expect(
      service.findVendorPrices({
        productCode: 'IT001',
        site: 'CORP',
        vendor: 'B Vendor',
      }),
    ).resolves.toEqual([]);
  });

  it('combines availability from code and imported site name aliases', async () => {
    const { service, vendorModel } = makeService([]);
    await expect(
      service.findAvailableNormalizedCodesForSite(['IT001', 'IT002'], 'CORP'),
    ).resolves.toEqual(['it001', 'it002']);
    expect(vendorModel.distinct).toHaveBeenCalledWith('productCodeNormalized', {
      siteNormalized: {
        $in: expect.arrayContaining([
          'a',
          'jakartaa',
          'jakarta a',
          'b',
          'jakartab',
          'jakarta b',
        ]),
      },
      productCodeNormalized: { $in: ['it001', 'it002'] },
    });
  });

  it('returns no vendors when all reference prices are invalid', async () => {
    const { service } = makeService([
      price('A', 'A Vendor', 'KG', -1),
      price('B', 'B Vendor', 'KG'),
    ]);
    await expect(
      service.findVendorPrices({ productCode: 'IT001', site: 'CORP' }),
    ).resolves.toEqual([]);
  });
});
