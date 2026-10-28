import { Types, type PipelineStage } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MenuProductionsService } from './menu-productions.service';
import {
  productionBatchPagePipeline,
  type ProductionBatchPage,
} from './production-batch-page';
import { ListMenuProductionsQueryDto } from './dto/list-menu-productions.query.dto';

describe('Production table pagination', () => {
  const recipeId = new Types.ObjectId();
  const ids = [new Types.ObjectId(), new Types.ObjectId()];
  const menus = ids.map((_id) => ({
    _id,
    site: 'SITE-A',
    productionDate: '2026-10-01',
    productionCode: 'MPR001',
    recipeId: String(recipeId),
    menuName: 'Rice',
    portion: 10,
    approvalStatus: 'approved',
    storeRequestStatus: 'requested',
  }));
  const setup = (
    pageItems = [
      { _id: { site: 'SITE-A', date: '2026-10-01', code: 'MPR001' }, ids },
    ],
  ) => {
    const model = {
      aggregate: jest
        .fn<Promise<ProductionBatchPage[]>, [PipelineStage[]]>()
        .mockResolvedValue([
          {
            items: pageItems,
            total: [{ count: 5000 }],
            clients: [{ _id: 'KTB' }],
          },
        ]),
      find: jest.fn().mockReturnValue({
        sort: jest
          .fn()
          .mockReturnValue({ lean: jest.fn().mockResolvedValue(menus) }),
      }),
    };
    const recipes = {
      find: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([
            { _id: recipeId, name: 'Rice', portionSize: 1, ingredients: [] },
          ]),
      }),
    };
    const service = new MenuProductionsService(
      model as never,
      {} as never,
      recipes as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { model, recipes, service };
  };

  it('loads complete batches on the selected page and only the recipes referenced by those menus', async () => {
    const { model, recipes, service } = setup();
    const result = await service.buildStoreRequestGroups(
      { page: 2, limit: 10, view: 'records' },
      'SITE-A',
    );
    expect(result.total).toBe(5000);
    expect(result.clients).toEqual(['KTB']);
    expect(result.items[0].items).toHaveLength(2);
    expect(model.find).toHaveBeenCalledTimes(1);
    expect(model.find).toHaveBeenCalledWith({
      $and: [
        expect.objectContaining({ $and: [{ site: 'SITE-A' }] }),
        { _id: { $in: ids } },
      ],
    });
    expect(recipes.find).toHaveBeenCalledTimes(1);
    expect(recipes.find).toHaveBeenCalledWith({
      _id: { $in: [String(recipeId)] },
    });
    const pipeline = model.aggregate.mock.calls[0][0];
    const facet = pipeline.find(
      (stage): stage is PipelineStage.Facet => '$facet' in stage,
    );
    expect(facet?.$facet.items).toEqual(
      expect.arrayContaining([{ $skip: 10 }, { $limit: 10 }]),
    );
  });

  it('keeps name fallback and the earliest recipe version for legacy menus without recipe ids', async () => {
    const { model, recipes, service } = setup();
    model.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([
            { ...menus[0], recipeId: undefined, menuName: ' Rice ' },
          ]),
      }),
    });
    recipes.find.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([]) });
    recipes.find.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          name: 'Rice',
          version: 2,
          recipeCode: 'RICE-V2',
          portionSize: 1,
          ingredients: [],
        },
        {
          _id: new Types.ObjectId(),
          name: 'Rice',
          version: 1,
          recipeCode: 'RICE-V1',
          portionSize: 1,
          ingredients: [],
        },
      ]),
    });
    const result = await service.buildStoreRequestGroups(
      { page: 1, limit: 10, view: 'approval' },
      'SITE-A',
    );
    expect(result.items[0].items[0].recipeCode).toBe('RICE-V1');
    expect(recipes.find).toHaveBeenNthCalledWith(1, { _id: { $in: [] } });
    expect(recipes.find).toHaveBeenNthCalledWith(2, {
      $or: [{ name: /^\s*Rice\s*$/i }],
    });
  });

  it('does not hydrate menus or recipes for an empty page', async () => {
    const { model, recipes, service } = setup([]);
    const result = await service.buildStoreRequestGroups(
      { page: 999, limit: 10, view: 'approval' },
      'SITE-A',
      '507f1f77bcf86cd799439011',
      true,
    );
    expect(result.items).toEqual([]);
    expect(model.find).not.toHaveBeenCalled();
    expect(recipes.find).not.toHaveBeenCalled();
    const pipeline = model.aggregate.mock.calls[0][0];
    const scopedFilter = (pipeline[0] as PipelineStage.Match).$match as Record<
      string,
      unknown
    >;
    expect(scopedFilter.$and).toContainEqual({ site: 'SITE-A' });
    expect(JSON.stringify(scopedFilter)).toContain('507f1f77bcf86cd799439011');
  });

  it('paginates chef drafts without dropping other menus in the selected batch', async () => {
    const { model, service } = setup();
    const result = await service.findDrafts('chef-id', 'SITE-A', false, {
      page: 1,
      limit: 10,
    });
    expect(result.total).toBe(5000);
    expect(result.items).toHaveLength(2);
    expect(model.find).toHaveBeenCalledWith({
      $and: [
        { isDraft: true, createdBy: 'chef-id', site: 'SITE-A' },
        { _id: { $in: ids } },
      ],
    });
  });

  it('applies status, client and date selection before paging, while export can select all batches', () => {
    const pipeline = productionBatchPagePipeline(
      { site: 'SITE-A', isDraft: { $ne: true } },
      {
        approvalStatus: 'pending',
        view: 'approval',
        page: 3,
        limit: 10,
        clientName: ' KTB ',
        startDate: '2026-10-01',
        endDate: '2026-10-28',
        dateSort: 'production-desc',
      },
    );
    expect(pipeline[0]).toEqual({
      $match: { site: 'SITE-A', isDraft: { $ne: true } },
    });
    const facet = pipeline.find(
      (stage): stage is PipelineStage.Facet => '$facet' in stage,
    );
    expect(facet?.$facet.items[0]).toMatchObject({
      $match: {
        normalizedClients: 'ktb',
        '_id.date': { $gte: '2026-10-01', $lte: '2026-10-28' },
      },
    });
    expect(facet?.$facet.items).toContainEqual({ $skip: 20 });
    const exported = productionBatchPagePipeline({}, { view: 'records' }).find(
      (stage): stage is PipelineStage.Facet => '$facet' in stage,
    );
    expect(
      exported?.$facet.items.some(
        (stage) => '$limit' in stage || '$skip' in stage,
      ),
    ).toBe(false);
  });

  it('rejects fractional pagination, unbounded page sizes, and unknown view modes', async () => {
    for (const input of [
      { page: '1.5' },
      { limit: '101' },
      { view: 'anything' },
    ]) {
      expect(
        (await validate(plainToInstance(ListMenuProductionsQueryDto, input)))
          .length,
      ).toBeGreaterThan(0);
    }
  });
});
