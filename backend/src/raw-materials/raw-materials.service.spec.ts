import { RawMaterialsService } from './raw-materials.service';

describe('RawMaterialsService specific conversions', () => {
  const makeService = (rawMaterials: unknown[]) => {
    const lean = jest.fn().mockResolvedValue(rawMaterials);
    const select = jest.fn().mockReturnValue({ lean });
    const rawMaterialModel = {
      find: jest.fn().mockReturnValue({ select }),
      bulkWrite: jest
        .fn()
        .mockResolvedValue({ modifiedCount: rawMaterials.length }),
    };
    const service = new RawMaterialsService(
      rawMaterialModel as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { rawMaterialModel, service };
  };

  it('adds a bulk rule without removing existing or legacy rules', async () => {
    const { rawMaterialModel, service } = makeService([
      {
        _id: 'raw-a',
        unitOfMeasures: 'GAL',
        baseUnitOfMeasures: 'ML',
        conversionFactor: 2200,
        specificConversions: [
          {
            prodUomCode: 'GR',
            srUomCode: 'KG',
            conversionFactor: 1000,
          },
        ],
      },
    ]);

    const result = await service.bulkUpdateSpecificConversions({
      rawMaterialIds: ['raw-a'],
      unitOfMeasures: 'L',
      baseUnitOfMeasures: 'GR',
      conversionFactor: 850,
    });

    const findCalls = rawMaterialModel.find.mock.calls as unknown as Array<
      [
        {
          _id: { $in: string[] };
        },
      ]
    >;
    expect(findCalls[0][0]).toEqual({ _id: { $in: ['raw-a'] } });
    expect(rawMaterialModel.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { _id: 'raw-a' },
            update: {
              $set: {
                specificConversions: [
                  {
                    prodUomCode: 'GR',
                    srUomCode: 'KG',
                    conversionFactor: 1000,
                  },
                  {
                    prodUomCode: 'ML',
                    srUomCode: 'GAL',
                    conversionFactor: 2200,
                  },
                  {
                    prodUomCode: 'GR',
                    srUomCode: 'L',
                    conversionFactor: 850,
                  },
                ],
              },
              $unset: { baseUnitOfMeasures: 1, conversionFactor: 1 },
            },
          },
        },
      ],
      { ordered: false },
    );
    expect(result).toEqual({
      requestedCount: 1,
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  it('replaces an existing rule with the same production and SR units', async () => {
    const { rawMaterialModel, service } = makeService([
      {
        _id: 'raw-b',
        unitOfMeasures: 'L',
        specificConversions: [
          {
            prodUomCode: 'gr',
            srUomCode: 'l',
            conversionFactor: 800,
          },
        ],
      },
    ]);

    await service.bulkUpdateSpecificConversions({
      rawMaterialIds: ['raw-b'],
      unitOfMeasures: 'L',
      baseUnitOfMeasures: 'GR',
      conversionFactor: 850,
    });

    const calls = rawMaterialModel.bulkWrite.mock.calls as unknown as Array<
      [
        Array<{
          updateOne: {
            update: { $set: { specificConversions: unknown[] } };
          };
        }>,
      ]
    >;
    expect(calls[0][0][0].updateOne.update.$set.specificConversions).toEqual([
      {
        prodUomCode: 'GR',
        srUomCode: 'L',
        conversionFactor: 850,
      },
    ]);
  });
});

describe('RawMaterialsService price updates', () => {
  const existingRawMaterial = {
    _id: 'raw-chicken',
    productCode: 'IT00900_N',
    productCodeNormalized: 'it00900_n',
    name: 'Chicken Breast',
    unitOfMeasures: 'KG (KG)',
  };

  const makePriceService = (vendorPrices: unknown[] = []) => {
    const rawLean = jest.fn().mockResolvedValue([existingRawMaterial]);
    const rawSelect = jest.fn().mockReturnValue({ lean: rawLean });
    const rawMaterialModel = {
      find: jest.fn().mockReturnValue({ select: rawSelect }),
      bulkWrite: jest
        .fn()
        .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    const vendorLean = jest.fn().mockResolvedValue(vendorPrices);
    const vendorSelect = jest.fn().mockReturnValue({ lean: vendorLean });
    const rawMaterialVendorPriceModel = {
      find: jest.fn().mockReturnValue({ select: vendorSelect }),
      bulkWrite: jest.fn().mockResolvedValue({
        matchedCount: vendorPrices.length ? 1 : 0,
        modifiedCount: vendorPrices.length ? 1 : 0,
        upsertedCount: vendorPrices.length ? 0 : 1,
        deletedCount: Math.max(vendorPrices.length - 1, 0),
      }),
    };
    const service = new RawMaterialsService(
      rawMaterialModel as never,
      rawMaterialVendorPriceModel as never,
      {} as never,
      {} as never,
    );

    return { rawMaterialModel, rawMaterialVendorPriceModel, service };
  };

  it('keeps raw material imports create-only and normalizes quantity prices', async () => {
    const rawMaterialModel = {
      bulkWrite: jest.fn().mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 0,
        upsertedCount: 0,
      }),
    };
    const service = new RawMaterialsService(
      rawMaterialModel as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.bulkUpsertByProductCode([
      {
        productCode: 'IT00786_N',
        name: 'Kemangi',
        unitOfMeasures: 'KG (KG)',
        price: 7000,
        priceQuantity: 0.1,
      },
    ]);

    expect(rawMaterialModel.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { productCodeNormalized: 'it00786_n' },
            update: {
              $setOnInsert: {
                productCode: 'IT00786_N',
                productCodeNormalized: 'it00786_n',
                name: 'Kemangi',
                unitOfMeasures: 'KG (KG)',
                price: 70000,
              },
            },
            upsert: true,
          },
        },
      ],
      { ordered: false },
    );
  });

  it('preserves legacy master price updates', async () => {
    const { rawMaterialModel, rawMaterialVendorPriceModel, service } =
      makePriceService();

    const result = await service.bulkUpdatePricesByProductCode([
      { productCode: 'IT00900_N', price: 42500 },
    ]);

    expect(rawMaterialModel.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { productCodeNormalized: 'it00900_n' },
            update: { $set: { price: 42500 } },
          },
        },
      ],
      { ordered: false },
    );
    expect(rawMaterialVendorPriceModel.bulkWrite).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: 'master',
      matchedCount: 1,
      modifiedCount: 1,
      vendorPriceUniqueCount: 0,
    });
  });

  it('replaces a lower current vendor price and removes stale duplicates', async () => {
    const previousVendorPrices = [
      {
        _id: 'japfa-current',
        productCodeNormalized: 'it00900_n',
        siteNormalized: 'sitea',
        vendorNormalized: 'japfa food indonesia pt',
        currencyNormalized: 'idr',
        unitOfMeasuresNormalized: 'kg (kg)',
        price: 50000,
        updatedAt: new Date('2026-07-01'),
      },
      {
        _id: 'japfa-stale',
        productCodeNormalized: 'it00900_n',
        siteNormalized: 'site a',
        vendorNormalized: 'japfa food indonesia pt',
        currencyNormalized: 'idr',
        unitOfMeasuresNormalized: 'kg',
        price: 50000,
        updatedAt: new Date('2026-06-01'),
      },
    ];
    const { rawMaterialModel, rawMaterialVendorPriceModel, service } =
      makePriceService(previousVendorPrices);

    const result = await service.bulkUpdatePricesByProductCode([
      {
        productCode: 'IT00900_N',
        name: 'Chicken Breast',
        site: 'Site A',
        vendor: 'JAPFA FOOD INDONESIA PT',
        currency: 'IDR',
        unitOfMeasures: 'KG (KG)',
        priceQuantity: 1,
        price: 42500,
      },
    ]);

    expect(rawMaterialModel.bulkWrite).not.toHaveBeenCalled();
    const vendorCalls = rawMaterialVendorPriceModel.bulkWrite.mock
      .calls as unknown as Array<
      [
        Array<{
          updateOne?: {
            filter: { _id: string };
            update: { $set: Record<string, unknown> };
          };
          deleteMany?: { filter: { _id: { $in: string[] } } };
        }>,
        { ordered: boolean },
      ]
    >;
    const [vendorOperations, vendorOptions] = vendorCalls[0];
    const updateOperation = vendorOperations.find(
      (operation) => operation.updateOne,
    );
    const deleteOperation = vendorOperations.find(
      (operation) => operation.deleteMany,
    );
    expect(vendorOptions).toEqual({ ordered: false });
    expect(updateOperation?.updateOne?.filter).toEqual({
      _id: 'japfa-current',
    });
    expect(updateOperation?.updateOne?.update.$set).toMatchObject({
      price: 42500,
      priceQuantity: 1,
    });
    expect(deleteOperation?.deleteMany).toEqual({
      filter: { _id: { $in: ['japfa-stale'] } },
    });
    expect(result).toMatchObject({
      mode: 'vendor',
      vendorPriceMatchedCount: 1,
      vendorPriceModifiedCount: 1,
      vendorPriceUpsertedCount: 0,
      vendorPriceDuplicateRemovedCount: 1,
    });
  });

  it('adds a new vendor only when its raw material already exists', async () => {
    const { rawMaterialVendorPriceModel, service } = makePriceService();

    const result = await service.bulkUpdatePricesByProductCode([
      {
        productCode: 'IT00900_N',
        site: 'Site A',
        vendor: 'TENARD JAYA CV',
        currency: 'IDR',
        unitOfMeasures: 'KG (KG)',
        price: 44000,
      },
    ]);

    expect(rawMaterialVendorPriceModel.bulkWrite).toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: 'vendor',
      matchedProductCount: 1,
      vendorPriceUpsertedCount: 1,
      notFoundCount: 0,
    });
  });

  it('keeps quantity-based vendor prices without creating missing materials', async () => {
    const { rawMaterialModel, rawMaterialVendorPriceModel, service } =
      makePriceService();
    rawMaterialModel.find.mockReturnValueOnce({
      select: jest
        .fn()
        .mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });

    const result = await service.bulkUpdatePricesByProductCode([
      {
        productCode: 'NEW-001',
        site: 'Site A',
        vendor: 'Vendor A',
        unitOfMeasures: 'KG',
        priceQuantity: 0.1,
        price: 7000,
      },
    ]);

    expect(rawMaterialModel.bulkWrite).not.toHaveBeenCalled();
    expect(rawMaterialVendorPriceModel.bulkWrite).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: 'vendor',
      notFoundCount: 1,
      notFoundRowCount: 1,
      notFoundProductCodes: ['NEW-001'],
      priceQuantityAdjustedCount: 1,
    });
  });

  it('returns only the latest vendor option for a requested site', async () => {
    const records = [
      {
        _id: 'japfa-old',
        productCode: 'IT00900_N',
        productCodeNormalized: 'it00900_n',
        name: 'Chicken Breast',
        unitOfMeasures: 'KG',
        unitOfMeasuresNormalized: 'kg',
        site: 'Site A',
        siteNormalized: 'sitea',
        vendor: 'JAPFA FOOD INDONESIA PT',
        vendorNormalized: 'japfa food indonesia pt',
        price: 50000,
        updatedAt: new Date('2026-07-01'),
      },
      {
        _id: 'japfa-new',
        productCode: 'IT00900_N',
        productCodeNormalized: 'it00900_n',
        name: 'Chicken Breast',
        unitOfMeasures: 'KG (KG)',
        unitOfMeasuresNormalized: 'kg (kg)',
        site: 'SITE-A',
        siteNormalized: 'sitea',
        vendor: 'JAPFA FOOD INDONESIA PT',
        vendorNormalized: 'japfa food indonesia pt',
        price: 42500,
        updatedAt: new Date('2026-07-20'),
      },
    ];
    const lean = jest.fn().mockResolvedValue(records);
    const limit = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ limit });
    const vendorModel = { find: jest.fn().mockReturnValue({ sort }) };
    const sites = {
      findSummariesByCodes: jest.fn().mockResolvedValue(new Map()),
    };
    const service = new RawMaterialsService(
      {} as never,
      vendorModel as never,
      {} as never,
      sites as never,
    );

    const result = await service.findVendorPrices({
      productCode: 'IT00900_N',
      site: 'Site A',
    });

    expect(result).toEqual([records[1]]);
  });
});
