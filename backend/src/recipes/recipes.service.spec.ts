import { RecipesService } from './recipes.service';
import { AppRole } from '../auth/roles.constants';

type TestIngredient = Record<string, unknown> & {
  conversionMultiplier?: number;
};

type RecipeUpdatePayload = {
  $unset?: Record<string, unknown>;
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
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ approvalStatus: 'pending' }),
      }),
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
      findVendorPrices: jest.fn().mockResolvedValue([]),
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

  const estimatedIngredient = {
    ingredientType: 'NMP' as const,
    productCode: 'NMP',
    name: 'Local ingredient',
    unitOfMeasures: 'KG',
    qty: 2,
    priceUom: 10,
    foodCost: 20,
  };

  it.each([AppRole.Chef, AppRole.CorporateChef])(
    'retains estimates while %s saves a draft',
    async (role) => {
      const { recipeModel, service } = makeService();
      recipeModel.create.mockImplementation((payload: object) =>
        Promise.resolve({ _id: 'draft', ...payload }),
      );
      await service.create(
        {
          name: 'Draft',
          category: 'Main',
          saveAsDraft: true,
          ingredients: [estimatedIngredient],
        },
        { id: 'author', roles: [role] },
      );
      expect(recipeModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          foodCostRecipe: 20,
          ingredients: [estimatedIngredient],
          approvalStatus: 'pending',
        }),
      );
    },
  );

  it.each([AppRole.CorporateChef, AppRole.Superadmin])(
    'does not store estimates when %s creates an auto-approved recipe',
    async (role) => {
      const { recipeModel, service } = makeService();
      recipeModel.create.mockImplementation((payload: object) =>
        Promise.resolve({ _id: 'approved', ...payload }),
      );
      await service.create(
        {
          name: 'Approved',
          category: 'Main',
          foodCostRecipe: 20,
          ingredients: [estimatedIngredient],
        },
        { id: 'author', roles: [role] },
      );
      const calls = recipeModel.create.mock.calls as unknown as Array<
        [
          {
            foodCostRecipe?: number;
            ingredients: TestIngredient[];
          },
        ]
      >;
      expect(calls[0][0].foodCostRecipe).toBeUndefined();
      expect(calls[0][0].ingredients[0].foodCost).toBeUndefined();
      expect(calls[0][0].ingredients[0].priceUom).toBe(10);
    },
  );

  it.each([AppRole.CorporateChef, AppRole.UnitManager])(
    'expires estimates when approved by %s',
    async (role) => {
      const { recipeModel, service } = makeService();
      recipeModel.findOne.mockReturnValue(
        mockRecipeQuery({ ingredients: [estimatedIngredient] }),
      );
      recipeModel.findOneAndUpdate.mockReturnValue(
        mockRecipeQuery({ _id: 'approved' }),
      );
      await service.setApprovalStatus('recipe', 'approved', {
        id: 'approver',
        roles: [role],
      });
      const update = getUpdatePayload(recipeModel);
      expect(update.$unset?.foodCostRecipe).toBe('');
      expect(update.$set.foodCostRecipe).toBeUndefined();
      expect(update.$set.ingredients?.[0].foodCost).toBeUndefined();
      expect(update.$set.ingredients?.[0].qty).toBe(2);
    },
  );

  it('does not restore estimates when an approved recipe is edited', async () => {
    const { recipeModel, service } = makeService();
    recipeModel.findOne.mockReturnValue(
      mockRecipeQuery({ approvalStatus: 'approved' }),
    );
    recipeModel.findOneAndUpdate.mockReturnValue(
      mockRecipeQuery({ _id: 'approved' }),
    );
    await service.updateById('recipe', {
      foodCostRecipe: 20,
      ingredients: [estimatedIngredient],
    });
    const update = getUpdatePayload(recipeModel);
    expect(update.$unset?.foodCostRecipe).toBe('');
    expect(update.$set.foodCostRecipe).toBeUndefined();
    expect(update.$set.ingredients?.[0].foodCost).toBeUndefined();
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
      isActive: { $ne: false },
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
      isActive: { $ne: false },
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
      isActive: { $ne: false },
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
    expect(getUpdatePayload(recipeModel).$unset).toMatchObject({
      foodCostRecipe: '',
      'ingredients.$[].foodCost': '',
    });
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
        ingredients: [estimatedIngredient],
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

    expect(getUpdatePayload(recipeModel).$unset?.foodCostRecipe).toBe('');
    expect(
      getUpdatePayload(recipeModel).$set.ingredients?.[0].foodCost,
    ).toBeUndefined();
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

  it('saves the selected vendor using its site price instead of the master or submitted price', async () => {
    const { rawMaterials, recipeModel, service } = makeService();
    recipeModel.findOne.mockReturnValue(mockRecipeQuery({ site: 'SITE-A' }));
    recipeModel.findOneAndUpdate.mockReturnValue(
      mockRecipeQuery({ _id: 'recipe-a' }),
    );
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([
      { productCodeNormalized: 'rm-001', price: 100 },
    ]);
    rawMaterials.findVendorPrices.mockResolvedValue([
      { vendor: 'Vendor A', unitOfMeasures: 'KG', price: 10 },
      { vendor: 'Vendor B', unitOfMeasures: 'KG', price: 20 },
    ]);

    await service.updateById('recipe-a', {
      ingredients: [
        {
          ingredientType: 'IT',
          productCode: 'RM-001',
          name: 'Chicken',
          unitOfMeasures: 'KG',
          qty: 2,
          vendor: 'Vendor A',
          priceUom: 999,
          foodCost: 1998,
        },
      ],
    });

    expect(rawMaterials.findVendorPrices).toHaveBeenCalledWith({
      productCode: 'RM-001',
      site: 'SITE-A',
    });
    expect(getUpdatedIngredient(recipeModel)).toEqual(
      expect.objectContaining({
        vendor: 'Vendor A',
        priceUom: 10,
        foodCost: 20,
      }),
    );
  });

  it.each([
    { vendor: 'Another vendor', unitOfMeasures: 'KG', price: 10 },
    { vendor: 'Vendor A', unitOfMeasures: 'BOX', price: 10 },
    { vendor: 'Vendor A', unitOfMeasures: 'KG', price: undefined },
  ])(
    'rejects an unavailable vendor price or incompatible unit: %j',
    async (option) => {
      const { rawMaterials, recipeModel, service } = makeService();
      recipeModel.findOne.mockReturnValue(mockRecipeQuery({ site: 'SITE-A' }));
      rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([
        { productCodeNormalized: 'rm-001', price: 100 },
      ]);
      rawMaterials.findVendorPrices.mockResolvedValue([option]);

      await expect(
        service.updateById('recipe-a', {
          ingredients: [
            {
              ingredientType: 'IT',
              productCode: 'RM-001',
              name: 'Chicken',
              unitOfMeasures: 'KG',
              qty: 2,
              vendor: 'Vendor A',
            },
          ],
        }),
      ).rejects.toThrow('has no valid price for this site and unit');
      expect(recipeModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('syncs selected vendor prices within each recipe site and reuses product lookups', async () => {
    const { rawMaterials, recipeModel, service } = makeService();
    const ingredient = {
      ingredientType: 'IT',
      productCode: 'RM-001',
      name: 'Chicken',
      unitOfMeasures: 'KG',
      qty: 2,
      vendor: 'Vendor A',
      priceUom: 1,
      foodCost: 2,
    };
    recipeModel.find.mockReturnValue(
      mockRecipeQuery([
        {
          _id: 'recipe-a',
          site: 'SITE-A',
          ingredients: [ingredient, ingredient],
        },
        { _id: 'recipe-b', site: 'SITE-B', ingredients: [ingredient] },
      ]),
    );
    rawMaterials.findLookupsByNormalizedCodes.mockResolvedValue([
      { productCodeNormalized: 'rm-001', price: 100 },
    ]);
    rawMaterials.findVendorPrices.mockImplementation(
      ({ site }: { site: string }) =>
        Promise.resolve([
          {
            vendor: 'Vendor A',
            unitOfMeasures: 'KG',
            price: site === 'SITE-A' ? 10 : 20,
          },
        ]),
    );

    await service.backfillApprovedIngredientCosts();

    expect(rawMaterials.findVendorPrices).toHaveBeenCalledTimes(2);
    const updates = recipeModel.updateOne.mock.calls as unknown as Array<
      [{ _id: string }, RecipeUpdatePayload]
    >;
    expect(updates[0]?.[0]).toEqual({ _id: 'recipe-a' });
    expect(updates[0]?.[1].$set).toMatchObject({
      ingredients: [
        { vendor: 'Vendor A', priceUom: 10 },
        { vendor: 'Vendor A', priceUom: 10 },
      ],
    });
    expect(updates[1]?.[0]).toEqual({ _id: 'recipe-b' });
    expect(updates[1]?.[1].$set).toMatchObject({
      ingredients: [{ vendor: 'Vendor A', priceUom: 20 }],
    });
    for (const [, update] of updates) {
      expect(update.$set.foodCostRecipe).toBeUndefined();
      expect(
        update.$set.ingredients?.every(
          (ingredient) => ingredient.foodCost === undefined,
        ),
      ).toBe(true);
      expect(update.$unset?.foodCostRecipe).toBe('');
    }
  });

  describe('recipe conversion sync', () => {
    const ingredient = {
      productCode: 'RM-001',
      name: 'Ingredient A',
      unitOfMeasures: 'PK',
      prodUomCode: 'GR',
      prodQty: 3000,
      srUomCode: 'PK',
      srQty: 0.6,
      qty: 0.6,
      conversionId: 'GR To PK',
      conversionMultiplier: 1 / 5000,
      priceUom: 90000,
      foodCost: 54000,
    };

    const setup = (ingredients = [ingredient]) => {
      const mocks = makeService();
      mocks.recipeModel.find.mockReturnValue(
        mockRecipeQuery([
          { _id: 'recipe-a', approvalStatus: 'approved', ingredients },
        ]),
      );
      mocks.recipeModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
      mocks.rawMaterials.findLookupByNormalizedCode.mockResolvedValue({
        productCodeNormalized: 'rm-001',
        unitOfMeasures: 'PK',
        specificConversions: [
          { prodUomCode: 'GR', srUomCode: 'PK', conversionFactor: 15000 },
        ],
      });
      return mocks;
    };

    it('recalculates from production quantity with the current product rule and invalidates old estimates', async () => {
      const { service, recipeModel, unitOfMeasures } = setup();
      const result = await service.syncIngredientConversions();
      expect(result).toMatchObject({
        updatedRecipes: 1,
        updatedIngredients: 1,
      });
      expect(recipeModel.find).toHaveBeenCalledWith({
        deletedAt: { $exists: false },
        approvalStatus: { $in: ['approved', 'pending', 'rejected'] },
        isDraft: { $ne: true },
        'ingredients.0': { $exists: true },
      });
      expect(recipeModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'recipe-a', ingredients: [ingredient] }),
        expect.objectContaining({
          $unset: { foodCostRecipe: '' },
        }),
      );
      const calls = recipeModel.updateOne.mock.calls as unknown as Array<
        [unknown, RecipeUpdatePayload]
      >;
      expect(calls[0][1].$set.ingredients?.[0]).toMatchObject({
        prodQty: 3000,
        qty: 0.2,
        srQty: 0.2,
        conversionMultiplier: 1 / 15000,
        priceUom: 90000,
      });
      expect(calls[0][1].$set.ingredients?.[0].foodCost).toBeUndefined();
      expect(unitOfMeasures.findActiveConversion).not.toHaveBeenCalled();
    });

    it.each(['pending', 'rejected'])(
      'syncs %s recipes and recalculates their approval estimates without changing status',
      async (approvalStatus) => {
        const { service, recipeModel } = setup();
        recipeModel.find.mockReturnValue(
          mockRecipeQuery([
            { _id: 'recipe-a', approvalStatus, ingredients: [ingredient] },
          ]),
        );
        expect(await service.syncIngredientConversions()).toMatchObject({
          updatedRecipes: 1,
          updatedIngredients: 1,
        });
        const calls = recipeModel.updateOne.mock.calls as unknown as Array<
          [Record<string, unknown>, RecipeUpdatePayload]
        >;
        expect(calls[0][0].approvalStatus).toBe(approvalStatus);
        expect(calls[0][1].$set.ingredients?.[0]).toMatchObject({
          prodQty: 3000,
          qty: 0.2,
          srQty: 0.2,
          foodCost: 18000,
        });
        expect(calls[0][1].$set.foodCostRecipe).toBe(18000);
        expect(calls[0][1].$set.approvalStatus).toBeUndefined();
        expect(calls[0][1].$unset).toBeUndefined();
      },
    );

    it('does not compound conversions or write unchanged quantities on repeat sync', async () => {
      const { service, recipeModel } = setup([
        {
          ...ingredient,
          qty: 0.2,
          srQty: 0.2,
          conversionMultiplier: 1 / 15000,
        },
      ]);
      expect(await service.syncIngredientConversions()).toMatchObject({
        updatedRecipes: 0,
        updatedIngredients: 0,
      });
      expect(recipeModel.updateOne).not.toHaveBeenCalled();
    });

    it('preserves manual quantities and skips legacy ingredients without production quantity', async () => {
      const { service, recipeModel } = setup();
      recipeModel.find.mockReturnValue(
        mockRecipeQuery([
          {
            _id: 'recipe-a',
            ingredients: [
              { ...ingredient, srQtyManual: true },
              { ...ingredient, prodQty: undefined },
            ],
          },
        ]),
      );
      expect(await service.syncIngredientConversions()).toMatchObject({
        skippedManual: 1,
        skippedIncomplete: 1,
        updatedRecipes: 0,
      });
      expect(recipeModel.updateOne).not.toHaveBeenCalled();
    });

    it('uses an active global conversion when no product rule exists', async () => {
      const { service, recipeModel, rawMaterials, unitOfMeasures } = setup();
      rawMaterials.findLookupByNormalizedCode.mockResolvedValue({
        unitOfMeasures: 'PK',
      });
      unitOfMeasures.findActiveConversion.mockResolvedValue({
        prodUomCode: 'GR',
        srUomCode: 'PK',
        conversionId: 'GR To PK',
        multiplier: 1 / 15000,
      });
      expect(await service.syncIngredientConversions()).toMatchObject({
        updatedRecipes: 1,
      });
      expect(recipeModel.updateOne).toHaveBeenCalledTimes(1);
    });

    it('reports missing conversion rules without changing the ingredient', async () => {
      const { service, recipeModel, rawMaterials } = setup();
      rawMaterials.findLookupByNormalizedCode.mockResolvedValue({
        unitOfMeasures: 'PK',
      });
      expect(await service.syncIngredientConversions()).toMatchObject({
        skippedMissingConversion: 1,
        updatedRecipes: 0,
      });
      expect(recipeModel.updateOne).not.toHaveBeenCalled();
    });

    it('reports missing raw materials and does not swallow database failures', async () => {
      const { service, rawMaterials, recipeModel } = setup();
      rawMaterials.findLookupByNormalizedCode.mockResolvedValue(null);
      expect(await service.syncIngredientConversions()).toMatchObject({
        skippedIncomplete: 1,
      });
      expect(recipeModel.updateOne).not.toHaveBeenCalled();
      rawMaterials.findLookupByNormalizedCode.mockRejectedValue(
        new Error('Lookup failed'),
      );
      await expect(service.syncIngredientConversions()).rejects.toThrow(
        'Lookup failed',
      );
    });

    it('reports concurrent edits instead of counting an unapplied update', async () => {
      const { service, recipeModel } = setup();
      recipeModel.updateOne.mockResolvedValue({ modifiedCount: 0 });
      expect(await service.syncIngredientConversions()).toMatchObject({
        skippedConcurrentRecipes: 1,
        updatedRecipes: 0,
        updatedIngredients: 0,
      });
    });
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
