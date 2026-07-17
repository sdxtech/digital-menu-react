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
