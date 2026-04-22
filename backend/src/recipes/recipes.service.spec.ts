import { RecipesService } from './recipes.service';

describe('RecipesService site visibility', () => {
  const makeService = () => {
    const recipeModel = {
      find: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      distinct: jest.fn(),
    };
    const users = {
      findNamesByIds: jest.fn().mockResolvedValue(new Map()),
    };

    const service = new RecipesService(
      recipeModel as never,
      {} as never,
      {} as never,
      users as never,
    );
    jest
      .spyOn(
        service as unknown as {
          backfillMissingRecipeCodes: () => Promise<void>;
        },
        'backfillMissingRecipeCodes',
      )
      .mockResolvedValue(undefined);

    return { recipeModel, service };
  };

  const mockRecipeList = (
    recipeModel: ReturnType<typeof makeService>['recipeModel'],
    items: unknown[] = [],
  ) => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(items),
    };
    recipeModel.find.mockReturnValue(query);
    return query;
  };

  it('scopes pending recipe approvals to the unit manager site', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);

    await service.findAll({ approvalStatus: 'pending' }, 'A1');

    expect(recipeModel.find).toHaveBeenCalledWith({
      $and: [
        {
          $or: [{ site: 'A1' }, { site: { $exists: false } }, { site: '' }],
        },
      ],
      approvalStatus: 'pending',
    });
  });

  it('keeps approved recipe data visible across sites', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);

    await service.findAll({ approvalStatus: 'approved' }, 'B1');

    expect(recipeModel.find).toHaveBeenCalledWith({
      approvalStatus: 'approved',
    });
  });

  it('shows global approved recipes plus local non-approved recipes by default', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);

    await service.findAll({}, 'B1');

    expect(recipeModel.find).toHaveBeenCalledWith({
      $and: [
        {
          $or: [{ approvalStatus: 'approved' }, { site: 'B1' }],
        },
      ],
    });
  });

  it('limits approval updates to pending recipes in the actor site', async () => {
    const { recipeModel, service } = makeService();
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-a' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.setApprovalStatus('recipe-a', 'approved', { site: 'B1' });

    expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'recipe-a', approvalStatus: 'pending', site: 'B1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          approvalStatus: 'approved',
          status: 'active',
        }),
      }),
      { new: true },
    );
  });
});
