import { RecipesService } from './recipes.service';

type TestIngredient = Record<string, unknown> & {
  conversionMultiplier?: number;
};

type RecipeUpdatePayload = {
  $set: Record<string, unknown> & {
    ingredients?: TestIngredient[];
  };
};

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
    const sites = {
      findSummariesByCodes: jest.fn().mockResolvedValue(new Map()),
    };
    const rawMaterials = {
      findLookupByNormalizedCode: jest.fn().mockResolvedValue(null),
      findLookupsByNormalizedCodes: jest.fn().mockResolvedValue([]),
    };
    const unitOfMeasures = {
      findActiveConversion: jest.fn().mockResolvedValue(null),
    };
    const notifications = {
      createHierarchicalNotification: jest.fn().mockResolvedValue(null),
    };

    const service = new RecipesService(
      recipeModel as never,
      {} as never,
      rawMaterials as never,
      users as never,
      sites as never,
      unitOfMeasures as never,
      notifications as never,
    );
    jest
      .spyOn(
        service as unknown as {
          backfillMissingRecipeCodes: () => Promise<void>;
        },
        'backfillMissingRecipeCodes',
      )
      .mockResolvedValue(undefined);

    return { rawMaterials, recipeModel, service, unitOfMeasures };
  };

  const getUpdatePayload = (
    recipeModel: ReturnType<typeof makeService>['recipeModel'],
  ): RecipeUpdatePayload => {
    const calls = recipeModel.findOneAndUpdate.mock.calls as unknown as Array<
      [unknown, RecipeUpdatePayload]
    >;
    const payload = calls[0]?.[1];
    if (!payload) throw new Error('findOneAndUpdate was not called.');
    return payload;
  };

  const getUpdatedIngredient = (
    recipeModel: ReturnType<typeof makeService>['recipeModel'],
  ) => {
    const ingredient = getUpdatePayload(recipeModel).$set.ingredients?.[0];
    if (!ingredient) throw new Error('Recipe ingredient was not updated.');
    return ingredient;
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

    await service.findAll({ approvalStatus: 'pending' }, 'SITE-001');

    expect(recipeModel.find).toHaveBeenCalledWith({
      $and: [{ site: 'SITE-001' }],
      approvalStatus: 'pending',
      deletedAt: { $exists: false },
    });
  });

  it('keeps approved recipe data visible across sites', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);

    await service.findAll({ approvalStatus: 'approved' }, 'SITE-002');

    expect(recipeModel.find).toHaveBeenCalledWith({
      approvalStatus: 'approved',
      deletedAt: { $exists: false },
    });
  });

  it('shows global approved recipes plus local non-approved recipes by default', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);

    await service.findAll({}, 'SITE-002');

    expect(recipeModel.find).toHaveBeenCalledWith({
      $and: [
        {
          $or: [{ approvalStatus: 'approved' }, { site: 'SITE-002' }],
        },
      ],
      deletedAt: { $exists: false },
    });
  });

  it('limits approval updates to pending recipes in the actor site', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ingredients: [] }),
      }),
    });
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-a' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.setApprovalStatus('recipe-a', 'approved', {
      site: 'SITE-002',
    });

    const updatePayload = getUpdatePayload(recipeModel);

    expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'recipe-a', approvalStatus: 'pending', site: 'SITE-002' },
      expect.any(Object),
      { new: true },
    );
    expect(updatePayload.$set).toEqual(
      expect.objectContaining({
        approvalStatus: 'approved',
        status: 'active',
      }),
    );
  });

  it('uses raw material specific conversion when no global conversion exists', async () => {
    const { rawMaterials, recipeModel, service, unitOfMeasures } =
      makeService();
    const rawMaterial = {
      productCode: 'RM-001',
      productCodeNormalized: 'rm-001',
      name: 'Saus Tiram',
      unitOfMeasures: 'GAL',
      baseUnitOfMeasures: 'ML',
      conversionFactor: 2200,
      price: 10,
    };
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-a' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });
    unitOfMeasures.findActiveConversion.mockResolvedValue(null);
    rawMaterials.findLookupByNormalizedCode.mockResolvedValue(rawMaterial);
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([rawMaterial]);

    await service.updateById('recipe-a', {
      ingredients: [
        {
          productCode: 'RM-001',
          name: 'Saus Tiram',
          unitOfMeasures: 'gal',
          qty: 2,
          prodQty: 4400,
          prodUomCode: 'ml',
          srUomCode: 'gal',
        },
      ],
    });

    const ingredient = getUpdatedIngredient(recipeModel);

    expect(unitOfMeasures.findActiveConversion).not.toHaveBeenCalled();
    expect(rawMaterials.findLookupByNormalizedCode).toHaveBeenCalledWith(
      'rm-001',
    );
    expect(ingredient).toEqual(
      expect.objectContaining({
        productCode: 'RM-001',
        name: 'Saus Tiram',
        unitOfMeasures: 'GAL',
        qty: 2,
        prodQty: 4400,
        prodUomCode: 'ML',
        srQty: 2,
        srUomCode: 'GAL',
        conversionId: 'ML To GAL',
        priceUom: 10,
        foodCost: 20,
      }),
    );
    expect(Number(ingredient.conversionMultiplier)).toBeCloseTo(1 / 2200);
  });

  it('prioritizes raw material specific conversion over global conversion', async () => {
    const { rawMaterials, recipeModel, service, unitOfMeasures } =
      makeService();
    const rawMaterial = {
      productCode: 'RM-002',
      productCodeNormalized: 'rm-002',
      name: 'Saus Tiram Premium',
      unitOfMeasures: 'GAL',
      baseUnitOfMeasures: 'ML',
      conversionFactor: 450,
      price: 10,
    };
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-b' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });
    unitOfMeasures.findActiveConversion.mockResolvedValue({
      prodUomCode: 'ML',
      srUomCode: 'GAL',
      conversionId: 'ML To GAL',
      multiplier: 1 / 1000,
    });
    rawMaterials.findLookupByNormalizedCode.mockResolvedValue(rawMaterial);
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([rawMaterial]);

    await service.updateById('recipe-b', {
      ingredients: [
        {
          productCode: 'RM-002',
          name: 'Saus Tiram Premium',
          unitOfMeasures: 'GAL',
          qty: 1,
          prodQty: 900,
          prodUomCode: 'ML',
          srUomCode: 'GAL',
        },
      ],
    });

    const ingredient = getUpdatedIngredient(recipeModel);

    expect(unitOfMeasures.findActiveConversion).not.toHaveBeenCalled();
    expect(ingredient).toEqual(
      expect.objectContaining({
        qty: 2,
        srQty: 2,
        conversionId: 'ML To GAL',
      }),
    );
    expect(Number(ingredient.conversionMultiplier)).toBeCloseTo(1 / 450);
  });
});
