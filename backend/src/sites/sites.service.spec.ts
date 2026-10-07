import { SitesService } from './sites.service';

describe('SitesService corporate settings', () => {
  const operational = (code: string) => ({
    _id: code,
    code,
    name: code,
    isActive: true,
    siteFunction: 'operational',
    materialSource: 'own',
  });
  const makeService = (items: unknown[]) => {
    const model = {
      find: jest
        .fn()
        .mockReturnValue({ lean: jest.fn().mockResolvedValue(items) }),
      create: jest
        .fn()
        .mockImplementation((input: unknown) => Promise.resolve(input)),
    };
    return { model, service: new SitesService(model as never) };
  };

  it('defaults existing and new sites to operational with their own data', async () => {
    const { service } = makeService([]);
    expect(service.toSummary({ _id: 'a', name: 'A', code: 'A' })).toEqual(
      expect.objectContaining({
        siteFunction: 'operational',
        materialSource: 'own',
        referenceSiteCodes: [],
      }),
    );
    await expect(service.create({ name: 'A', code: 'A' })).resolves.toEqual(
      expect.objectContaining({
        siteFunction: 'operational',
        materialSource: 'own',
        referenceSiteCodes: [],
      }),
    );
  });

  it('normalizes reference codes and preserves priority', async () => {
    const { service } = makeService([operational('A'), operational('B')]);
    await expect(
      service.create({
        name: 'Corporate Kitchen',
        code: 'CORP',
        siteFunction: 'corporate',
        materialSource: 'reference',
        referenceSiteCodes: [' b ', 'a'],
      }),
    ).resolves.toEqual(
      expect.objectContaining({ referenceSiteCodes: ['B', 'A'] }),
    );
  });

  it.each(
    [[], ['CORP'], ['A', ' a '], ['MISSING']].map((referenceSiteCodes) => ({
      referenceSiteCodes,
    })),
  )(
    'rejects invalid references $referenceSiteCodes',
    async ({ referenceSiteCodes }) => {
      const { model, service } = makeService([operational('A')]);
      await expect(
        service.create({
          name: 'Corporate',
          code: 'CORP',
          materialSource: 'reference',
          referenceSiteCodes,
        }),
      ).rejects.toThrow();
      expect(model.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...operational('A'), isActive: false },
    { ...operational('A'), siteFunction: 'corporate' },
    { ...operational('A'), materialSource: 'reference' },
  ])(
    'rejects inactive, corporate, and indirect reference sites',
    async (site) => {
      const { service } = makeService([site]);
      await expect(
        service.create({
          name: 'Corporate',
          code: 'CORP',
          materialSource: 'reference',
          referenceSiteCodes: ['A'],
        }),
      ).rejects.toThrow('Reference sites must be active');
    },
  );

  it('resolves references in configured order, regardless of database order', async () => {
    const { model, service } = makeService([]);
    model.find.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue([
        {
          ...operational('CORP'),
          siteFunction: 'corporate',
          materialSource: 'reference',
          referenceSiteCodes: ['B', 'A'],
        },
      ]),
    });
    model.find.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue([operational('A'), operational('B')]),
    });
    const sources = await service.findMaterialSourceSites('CORP');
    expect(sources.map((site) => site.code)).toEqual(['B', 'A']);
  });

  it('blocks disabling a referenced operational site', async () => {
    const site = operational('A');
    const model = {
      findById: jest.fn().mockResolvedValue(site),
      exists: jest.fn().mockResolvedValue({ _id: 'CORP' }),
      findByIdAndUpdate: jest.fn(),
    };
    await expect(
      new SitesService(model as never).setActive(
        '507f1f77bcf86cd799439011',
        false,
      ),
    ).rejects.toThrow('used as a material reference');
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('lists active approval sites without filtering out corporate sites', async () => {
    const records = [
      operational('A'),
      { ...operational('HO'), siteFunction: 'corporate' },
    ];
    const model = {
      find: jest.fn().mockReturnValue({
        sort: jest
          .fn()
          .mockReturnValue({ lean: jest.fn().mockResolvedValue(records) }),
      }),
    };
    const result = await new SitesService(model as never).findApprovalSites();
    expect(model.find).toHaveBeenCalledWith({ isActive: { $ne: false } });
    expect(result.map((site) => site.code)).toEqual(['A', 'HO']);
  });
});
