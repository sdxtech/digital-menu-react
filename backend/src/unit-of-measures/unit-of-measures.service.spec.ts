import { UnitOfMeasuresService } from './unit-of-measures.service';

describe('UnitOfMeasuresService conversion search', () => {
  const setup = () => {
    const query = {
      collation: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    const conversionModel = {
      find: jest.fn().mockReturnValue(query),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    const service = new UnitOfMeasuresService(
      {} as never,
      conversionModel as never,
      {} as never,
    );
    return { service, conversionModel };
  };

  it('searches text without applying a regex to numeric EXT', async () => {
    const { service, conversionModel } = setup();

    await service.listConversions({ page: 1, limit: 20, search: 'GAL' });

    const filter = {
      $or: [
        { prodUomCode: /GAL/i },
        { srUomCode: /GAL/i },
        { conversionId: /GAL/i },
      ],
    };
    expect(conversionModel.find).toHaveBeenCalledWith(filter);
    expect(conversionModel.countDocuments).toHaveBeenCalledWith(filter);
  });

  it('matches numeric EXT by exact value', async () => {
    const { service, conversionModel } = setup();

    await service.listConversions({ page: 1, limit: 20, search: '1.5' });

    expect(conversionModel.find).toHaveBeenCalledWith({
      $or: [
        { prodUomCode: /1\.5/i },
        { srUomCode: /1\.5/i },
        { conversionId: /1\.5/i },
        { ext: 1.5 },
      ],
    });
  });
});
