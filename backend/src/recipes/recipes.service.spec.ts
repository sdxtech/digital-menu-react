import { RecipesService } from './recipes.service';
import { AppRole } from '../auth/roles.constants';

type TestIngredient = Record<string, unknown> & {
  conversionMultiplier?: number;
};

type RecipeUpdatePayload = {
  $set: Record<string, unknown> & {
    ingredients?: TestIngredient[];
  };
  $push?: Record<string, unknown>;
};

type RecipeCreatePayload = {
  parentRecipeId?: string;
};

describe('RecipesService site visibility', () => {
  const makeService = () => {
    const recipeModel = {
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
      exists: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      distinct: jest.fn(),
    };
    const recipeCodeCounterModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ seq: 1 }),
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
      findAvailableNormalizedCodesForSite: jest.fn().mockResolvedValue([]),
    };
    const unitOfMeasures = {
      findActiveConversion: jest.fn().mockResolvedValue(null),
    };
    const notifications = {
      createHierarchicalNotification: jest.fn().mockResolvedValue(null),
    };
    const workflowMail = {
      notifyRecipeSubmitted: jest.fn().mockResolvedValue(undefined),
      notifyRecipeDecision: jest.fn().mockResolvedValue(undefined),
    };

    const service = new RecipesService(
      recipeModel as never,
      recipeCodeCounterModel as never,
      rawMaterials as never,
      users as never,
      sites as never,
      unitOfMeasures as never,
      notifications as never,
      workflowMail as never,
    );
    jest
      .spyOn(
        service as unknown as {
          backfillMissingRecipeCodes: () => Promise<void>;
        },
        'backfillMissingRecipeCodes',
      )
      .mockResolvedValue(undefined);

    return {
      notifications,
      rawMaterials,
      recipeModel,
      service,
      unitOfMeasures,
      workflowMail,
    };
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

  const mockRecipeQuery = (result: unknown) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  it('creates an independent recipe as version 1', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.create.mockImplementation((payload: object) =>
      Promise.resolve({
        _id: 'recipe-v1',
        ...payload,
      }),
    );

    await service.create({
      name: 'Classic Cheesecake',
      category: 'Dessert',
      ingredients: [],
    });

    expect(recipeModel.findOne).not.toHaveBeenCalled();
    expect(recipeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeCode: 'RCP0001',
        name: 'Classic Cheesecake',
        version: 1,
        versionGroupId: 'RCP0001',
      }),
    );
    const createCalls = recipeModel.create.mock.calls as unknown as Array<
      [RecipeCreatePayload]
    >;
    expect(createCalls[0]?.[0].parentRecipeId).toBeUndefined();
  });

  it('stores a chef draft without notifying approvers', async () => {
    const { notifications, recipeModel, service, workflowMail } = makeService();
    recipeModel.create.mockImplementation((payload: object) =>
      Promise.resolve({ _id: 'recipe-draft', ...payload }),
    );

    await service.create(
      {
        name: 'Half Finished Recipe',
        category: 'Main Course',
        ingredients: [],
        saveAsDraft: true,
      },
      {
        id: 'chef-1',
        site: 'SITE-001',
        roles: [AppRole.Chef],
      },
    );

    expect(recipeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalStatus: 'pending',
        isDraft: true,
        status: 'draft',
      }),
    );
    expect(notifications.createHierarchicalNotification).not.toHaveBeenCalled();
    expect(workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
  });

  it('creates the next version without changing the base recipe name', async () => {
    const { recipeModel, service } = makeService();
    const baseRecipe = {
      _id: 'recipe-v1',
      recipeCode: 'RCP0042',
      name: 'Classic Cheesecake',
    };
    recipeModel.findOne
      .mockReturnValueOnce(mockRecipeQuery(baseRecipe))
      .mockReturnValueOnce(mockRecipeQuery({ version: 1 }));
    recipeModel.create.mockImplementation((payload: object) =>
      Promise.resolve({
        _id: 'recipe-v2',
        ...payload,
      }),
    );

    await service.create({
      baseRecipeId: 'recipe-v1',
      name: 'This name must be ignored',
      category: 'Dessert',
      ingredients: [],
    });

    expect(recipeModel.findOne).toHaveBeenNthCalledWith(1, {
      _id: 'recipe-v1',
      approvalStatus: 'approved',
      deletedAt: { $exists: false },
    });
    expect(recipeModel.updateOne).toHaveBeenCalledWith(
      { _id: 'recipe-v1' },
      {
        $set: {
          version: 1,
          versionGroupId: 'RCP0042',
        },
      },
    );
    expect(recipeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Classic Cheesecake',
        version: 2,
        versionGroupId: 'RCP0042',
        parentRecipeId: 'recipe-v1',
      }),
    );
  });

  it('rejects a new recipe when the name already exists', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.exists.mockResolvedValueOnce({ _id: 'existing-recipe' });

    await expect(
      service.create({
        name: 'Classic Cheesecake',
        category: 'Dessert',
        ingredients: [],
      }),
    ).rejects.toThrow(
      'A recipe with this name already exists. Please use a different name.',
    );
    expect(recipeModel.create).not.toHaveBeenCalled();
  });

  it('creates a corporate chef recipe as approved for the selected site', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.create.mockImplementation((payload: object) =>
      Promise.resolve({ _id: 'recipe-corporate', ...payload }),
    );

    await service.create(
      {
        site: 'SITE-002',
        name: 'Corporate Recipe',
        category: 'Main Course',
        ingredients: [],
      },
      {
        id: 'corporate-chef-a',
        name: 'Corporate Chef A',
        email: 'corporate@example.com',
        roles: [AppRole.CorporateChef],
        site: 'SITE-002',
        sites: ['SITE-001', 'SITE-002'],
      },
    );

    expect(recipeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        site: 'SITE-002',
        status: 'active',
        approvalStatus: 'approved',
        reviewedBy: 'corporate-chef-a',
        reviewedAt: expect.any(Date),
      }),
    );
  });

  it('stores a corporate chef recipe as a private draft when requested', async () => {
    const { notifications, recipeModel, service, workflowMail } = makeService();
    recipeModel.create.mockImplementation((payload: object) =>
      Promise.resolve({ _id: 'corporate-draft', ...payload }),
    );

    await service.create(
      {
        site: 'SITE-002',
        name: 'Corporate Draft',
        category: 'Main Course',
        ingredients: [],
        saveAsDraft: true,
      },
      {
        id: 'corporate-chef-a',
        roles: [AppRole.CorporateChef],
        site: 'SITE-002',
        sites: ['SITE-001', 'SITE-002'],
      },
    );

    expect(recipeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        site: 'SITE-002',
        status: 'draft',
        approvalStatus: 'pending',
        isDraft: true,
      }),
    );
    const createCalls = recipeModel.create.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const payload = createCalls[0]?.[0] ?? {};
    expect(payload.reviewedAt).toBeUndefined();
    expect(payload.reviewedBy).toBeUndefined();
    expect(notifications.createHierarchicalNotification).not.toHaveBeenCalled();
    expect(workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
  });

  it('rejects IT raw material outside the selected site scope', async () => {
    const { rawMaterials, recipeModel, service } = makeService();
    rawMaterials.findAvailableNormalizedCodesForSite.mockResolvedValue([]);

    await expect(
      service.create(
        {
          site: 'SITE-002',
          name: 'Corporate Recipe',
          category: 'Main Course',
          ingredients: [
            {
              ingredientType: 'IT',
              productCode: 'IT99999',
              name: 'Unavailable Material',
              unitOfMeasures: 'KG',
              qty: 1,
            },
          ],
        },
        {
          roles: [AppRole.CorporateChef],
          site: 'SITE-002',
          sites: ['SITE-001', 'SITE-002'],
        },
      ),
    ).rejects.toThrow(
      'Raw material IT99999 is not available for site SITE-002.',
    );
    expect(recipeModel.create).not.toHaveBeenCalled();
  });

  it('exposes legacy recipes without version metadata as version 1', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel, [
      {
        _id: 'legacy-recipe',
        recipeCode: 'RCP0099',
        name: 'Legacy Recipe',
        status: 'active',
        approvalStatus: 'approved',
      },
    ]);

    const result = await service.findAll({});

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        version: 1,
        versionGroupId: 'RCP0099',
      }),
    );
  });

  it('scopes pending recipe approvals to the unit manager site', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);

    await service.findAll({ approvalStatus: 'pending' }, 'SITE-001');

    expect(recipeModel.find).toHaveBeenCalledWith({
      $and: [{ site: 'SITE-001' }],
      approvalStatus: 'pending',
      deletedAt: { $exists: false },
      isDraft: { $ne: true },
    });
  });

  it('keeps approved recipe data visible across sites', async () => {
    const { recipeModel, service } = makeService();
    mockRecipeList(recipeModel);

    await service.findAll({ approvalStatus: 'approved' }, 'SITE-002');

    expect(recipeModel.find).toHaveBeenCalledWith({
      approvalStatus: 'approved',
      deletedAt: { $exists: false },
      isDraft: { $ne: true },
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
      isDraft: { $ne: true },
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

  it('records a rejection history entry for the reviewing actor', async () => {
    const { recipeModel, service } = makeService();
    const lean = jest.fn().mockResolvedValue({
      _id: 'recipe-a',
      approvalStatus: 'rejected',
    });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.setApprovalStatus(
      'recipe-a',
      'rejected',
      {
        id: 'manager-a',
        name: 'Manager A',
        email: 'manager@example.com',
        site: 'SITE-002',
      },
      'Adjust the salt quantity.',
    );

    expect(getUpdatePayload(recipeModel).$push).toEqual({
      approvalHistory: expect.objectContaining({
        rejectionReason: 'Adjust the salt quantity.',
        rejectedBy: 'manager-a',
        rejectedByName: 'Manager A',
        rejectedByEmail: 'manager@example.com',
      }),
    });
  });

  it('requires feedback and records it on the matching rejection cycle', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: 'recipe-a',
        approvalStatus: 'rejected',
        approvalHistory: [
          {
            rejectionReason: 'Adjust the salt quantity.',
            rejectedAt: new Date('2026-08-19T00:00:00.000Z'),
          },
        ],
      }),
    });
    const lean = jest.fn().mockResolvedValue({
      _id: 'recipe-a',
      approvalStatus: 'pending',
    });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await expect(
      service.resubmitRejectedRecipe('recipe-a', { site: 'SITE-002' }),
    ).rejects.toThrow('Resubmission feedback is required.');

    await service.resubmitRejectedRecipe(
      'recipe-a',
      {
        id: 'chef-a',
        name: 'Chef A',
        email: 'chef@example.com',
        site: 'SITE-002',
      },
      'Reduced salt from 10 g to 7 g.',
    );

    const updatePayload = getUpdatePayload(recipeModel);
    expect(updatePayload.$set).toEqual(
      expect.objectContaining({
        approvalStatus: 'pending',
        'approvalHistory.0.resubmissionFeedback':
          'Reduced salt from 10 g to 7 g.',
        'approvalHistory.0.resubmittedBy': 'chef-a',
      }),
    );
  });

  it('automatically approves a pending recipe edited by a corporate chef', async () => {
    const { recipeModel, service } = makeService();
    const lean = jest.fn().mockResolvedValue({
      _id: 'recipe-a',
      approvalStatus: 'approved',
      status: 'active',
    });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.updateById(
      'recipe-a',
      { name: 'Updated Recipe' },
      {
        id: 'corporate-chef-a',
        name: 'Corporate Chef A',
        email: 'corporate@example.com',
        roles: [AppRole.CorporateChef],
        site: 'SITE-001',
        sites: ['SITE-001', 'SITE-002'],
      },
    );

    expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'recipe-a',
        approvalStatus: 'pending',
        site: { $in: ['SITE-001', 'SITE-002'] },
      },
      expect.any(Object),
      { new: true },
    );
    expect(getUpdatePayload(recipeModel).$set).toEqual(
      expect.objectContaining({
        name: 'Updated Recipe',
        approvalStatus: 'approved',
        status: 'active',
        reviewedBy: 'corporate-chef-a',
        reviewedByName: 'Corporate Chef A',
        reviewedByEmail: 'corporate@example.com',
        reviewedAt: expect.any(Date),
      }),
    );
  });

  it('keeps a corporate chef draft private while it is being edited', async () => {
    const { recipeModel, service } = makeService();
    const lean = jest.fn().mockResolvedValue({
      _id: 'recipe-draft',
      isDraft: true,
      approvalStatus: 'pending',
      status: 'draft',
    });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.updateById(
      'recipe-draft',
      { name: 'Updated Draft', saveAsDraft: true },
      {
        id: 'corporate-chef-a',
        roles: [AppRole.CorporateChef],
        site: 'SITE-001',
        sites: ['SITE-001', 'SITE-002'],
      },
    );

    expect(recipeModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'recipe-draft',
        isDraft: true,
        createdBy: 'corporate-chef-a',
        site: { $in: ['SITE-001', 'SITE-002'] },
      },
      expect.any(Object),
      { new: true },
    );
    const update = getUpdatePayload(recipeModel).$set;
    expect(update.name).toBe('Updated Draft');
    expect(update.approvalStatus).toBeUndefined();
    expect(update.status).toBeUndefined();
    expect(update.reviewedAt).toBeUndefined();
  });

  it('activates a corporate chef draft without notifying approvers', async () => {
    const { notifications, recipeModel, service, workflowMail } = makeService();
    recipeModel.findOne.mockReturnValue(
      mockRecipeQuery({
        _id: 'recipe-draft',
        name: 'Ready Recipe',
        category: 'Main Course',
        ingredients: [{ name: 'Ingredient' }],
      }),
    );
    const lean = jest.fn().mockResolvedValue({
      _id: 'recipe-draft',
      name: 'Ready Recipe',
      category: 'Main Course',
      ingredients: [{ name: 'Ingredient' }],
    });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.submitDraft('recipe-draft', {
      id: 'corporate-chef-a',
      name: 'Corporate Chef A',
      roles: [AppRole.CorporateChef],
      site: 'SITE-001',
      sites: ['SITE-001', 'SITE-002'],
    });

    expect(getUpdatePayload(recipeModel).$set).toEqual(
      expect.objectContaining({
        isDraft: false,
        approvalStatus: 'approved',
        status: 'active',
        reviewedBy: 'corporate-chef-a',
        reviewedAt: expect.any(Date),
      }),
    );
    expect(notifications.createHierarchicalNotification).not.toHaveBeenCalled();
    expect(workflowMail.notifyRecipeSubmitted).not.toHaveBeenCalled();
  });

  it('does not allow a corporate chef without an assigned site to edit recipes', async () => {
    const { recipeModel, service } = makeService();

    await expect(
      service.updateById(
        'recipe-a',
        { name: 'Updated Recipe' },
        { roles: [AppRole.CorporateChef] },
      ),
    ).rejects.toThrow(
      'Corporate Chef must be assigned to a site before editing recipes.',
    );
    expect(recipeModel.findOneAndUpdate).not.toHaveBeenCalled();
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

  it('accepts a required manual SR quantity when no conversion is configured', async () => {
    const { rawMaterials, recipeModel, service, unitOfMeasures } =
      makeService();
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-manual' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });

    await service.updateById('recipe-manual', {
      ingredients: [
        {
          productCode: 'RM-MANUAL',
          name: 'Manual Ingredient',
          unitOfMeasures: 'L',
          qty: 2.5,
          prodQty: 1700,
          prodUomCode: 'GR',
          srQty: 2.5,
          srQtyManual: true,
          srUomCode: 'L',
        },
      ],
    });

    const ingredient = getUpdatedIngredient(recipeModel);

    expect(rawMaterials.findLookupByNormalizedCode).not.toHaveBeenCalled();
    expect(unitOfMeasures.findActiveConversion).not.toHaveBeenCalled();
    expect(ingredient).toEqual(
      expect.objectContaining({
        qty: 2.5,
        prodQty: 1700,
        prodUomCode: 'GR',
        srQty: 2.5,
        srQtyManual: true,
        srUomCode: 'L',
      }),
    );
    expect(ingredient.conversionId).toBeUndefined();
    expect(ingredient.conversionMultiplier).toBeUndefined();
  });

  it('selects the matching rule when a raw material has multiple specific conversions', async () => {
    const { rawMaterials, recipeModel, service, unitOfMeasures } =
      makeService();
    const rawMaterial = {
      productCode: 'RM-003',
      productCodeNormalized: 'rm-003',
      name: 'Cooking Oil',
      unitOfMeasures: 'L',
      specificConversions: [
        {
          prodUomCode: 'ML',
          srUomCode: 'KG',
          conversionFactor: 900,
        },
        {
          prodUomCode: 'GR',
          srUomCode: 'L',
          conversionFactor: 850,
        },
      ],
      price: 20,
    };
    const lean = jest.fn().mockResolvedValue({ _id: 'recipe-c' });
    recipeModel.findOneAndUpdate.mockReturnValue({ lean });
    unitOfMeasures.findActiveConversion.mockResolvedValue(null);
    rawMaterials.findLookupByNormalizedCode.mockResolvedValue(rawMaterial);
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([rawMaterial]);

    await service.updateById('recipe-c', {
      ingredients: [
        {
          productCode: 'RM-003',
          name: 'Cooking Oil',
          unitOfMeasures: 'L',
          qty: 2,
          prodQty: 1700,
          prodUomCode: 'GR',
          srUomCode: 'L',
        },
      ],
    });

    const ingredient = getUpdatedIngredient(recipeModel);

    expect(unitOfMeasures.findActiveConversion).not.toHaveBeenCalled();
    expect(ingredient).toEqual(
      expect.objectContaining({
        qty: 2,
        prodQty: 1700,
        prodUomCode: 'GR',
        srQty: 2,
        srUomCode: 'L',
        conversionId: 'GR To L',
      }),
    );
    expect(Number(ingredient.conversionMultiplier)).toBeCloseTo(1 / 850);
  });
});
