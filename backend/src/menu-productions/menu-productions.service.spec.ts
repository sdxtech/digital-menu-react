import { NotFoundException } from '@nestjs/common';
import { MenuProductionsService } from './menu-productions.service';

describe('MenuProductionsService sales input', () => {
  const createService = (menuProductionModel: Record<string, jest.Mock>) =>
    new MenuProductionsService(
      menuProductionModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('only updates pending menu productions', async () => {
    const findOneAndUpdate = jest.fn().mockResolvedValue(null);
    const service = createService({ findOneAndUpdate });

    await expect(
      service.updateSalesDetails(
        'menu-id',
        { sellingPricePerPax: 15000, sellingQuantity: 100 },
        undefined,
        'Admin Site',
      ),
    ).rejects.toThrow(NotFoundException);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'menu-id',
        approvalStatus: 'pending',
        isDraft: { $ne: true },
      },
      expect.any(Object),
      { new: true },
    );
  });

  it('requires a pending item when submitting batch sales details', async () => {
    const updateMany = jest.fn().mockResolvedValue({ matchedCount: 0 });
    const service = createService({ updateMany });

    await expect(
      service.updateBatchSalesDetails(
        'MPR0038',
        {
          productionCode: 'MPR0038',
          sellingPricePerPax: 15000,
          sellingQuantity: 100,
        },
        undefined,
        'Admin Site',
      ),
    ).rejects.toThrow(NotFoundException);

    expect(updateMany).toHaveBeenCalledWith(
      {
        productionCode: 'MPR0038',
        approvalStatus: 'pending',
        isDraft: { $ne: true },
      },
      expect.any(Object),
    );
  });

  it('dispatches an email to Unit Manager after batch sales details are submitted', async () => {
    const updatedItems = [
      {
        _id: 'menu-1',
        productionCode: 'MPR0038',
        menuName: 'Soup',
        productionDate: '2026-08-28',
        site: 'S001',
        createdBy: 'chef-1',
        unitManagerId: '507f1f77bcf86cd799439011',
        approvalStatus: 'pending',
      },
    ];
    const lean = jest.fn().mockResolvedValue(updatedItems);
    const menuProductionModel = {
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      find: jest.fn().mockReturnValue({ lean }),
    };
    const notifications = {
      createHierarchicalNotification: jest.fn().mockResolvedValue(undefined),
    };
    const workflowMail = {
      notifyMenuProductionsReadyForApproval: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    const service = new MenuProductionsService(
      menuProductionModel as never,
      {} as never,
      {} as never,
      {} as never,
      notifications as never,
      workflowMail as never,
    );

    await service.updateBatchSalesDetails(
      'MPR0038',
      {
        productionCode: 'MPR0038',
        sellingPricePerPax: 15000,
        sellingQuantity: 100,
      },
      'S001',
      'Admin Site',
    );

    expect(menuProductionModel.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        productionCode: 'MPR0038',
        isDraft: { $ne: true },
        site: 'S001',
      },
      {
        $set: expect.objectContaining({
          sellingPricePerPax: 15000,
          sellingQuantity: 100,
          salesInputBy: 'Admin Site',
        }),
      },
    );

    expect(
      workflowMail.notifyMenuProductionsReadyForApproval,
    ).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'menu-1',
          productionCode: 'MPR0038',
          site: 'S001',
          unitManagerId: '507f1f77bcf86cd799439011',
        }),
      ],
      expect.stringMatching(/^sales-resubmission-/),
    );
  });

  it('only lists menu production drafts owned by the chef', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ lean });
    const find = jest.fn().mockReturnValue({ sort });
    const service = createService({ find });

    await service.findDrafts('chef-1', 'SITE-001');

    expect(find).toHaveBeenCalledWith({
      createdBy: 'chef-1',
      isDraft: true,
      site: 'SITE-001',
    });
  });

  it('records the created date when Chef submits a draft batch', async () => {
    const submittedItems = [
      {
        _id: 'menu-1',
        productionCode: 'MPR0038',
        menuName: 'Soup',
        productionDate: '2026-08-28',
        site: 'SITE-001',
        createdBy: 'chef-1',
      },
    ];
    const lean = jest.fn().mockResolvedValue(submittedItems);
    const updateMany = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const notifications = {
      createHierarchicalNotification: jest.fn().mockResolvedValue(undefined),
    };
    const workflowMail = {
      notifyMenuProductionsSubmitted: jest.fn().mockResolvedValue(undefined),
    };
    const service = new MenuProductionsService(
      { updateMany, find: jest.fn().mockReturnValue({ lean }) } as never,
      {} as never,
      {} as never,
      {} as never,
      notifications as never,
      workflowMail as never,
    );

    await service.submitDraftBatch('MPR0038', 'chef-1', 'SITE-001');

    expect(updateMany).toHaveBeenCalledWith(
      {
        productionCode: 'MPR0038',
        createdBy: 'chef-1',
        isDraft: true,
        site: 'SITE-001',
      },
      {
        $set: {
          isDraft: false,
          submittedAt: expect.any(Date) as Date,
        },
      },
    );
  });
});

describe('MenuProductionsService batch approval flow', () => {
  const makeService = (
    updated: Record<string, unknown>,
    reviewedBatch: Array<Record<string, unknown>>,
  ) => {
    const salesLean = jest.fn().mockResolvedValue({
      sellingPricePerPax: 15000,
      sellingQuantity: 100,
    });
    const findOne = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: salesLean }),
    });
    const updatedLean = jest.fn().mockResolvedValue(updated);
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean: updatedLean });
    const batchLean = jest.fn().mockResolvedValue(reviewedBatch);
    const find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: batchLean }),
    });
    const updateMany = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const notifications = {
      createHierarchicalNotification: jest.fn().mockResolvedValue(undefined),
      markRoleNotificationsAsRead: jest.fn().mockResolvedValue(undefined),
    };
    const workflowMail = {
      notifyMenuProductionBatchReviewed: jest.fn().mockResolvedValue(undefined),
    };
    const menuProductionModel = {
      findOne,
      findOneAndUpdate,
      find,
      updateMany,
    };
    return {
      findOneAndUpdate,
      notifications,
      updateMany,
      workflowMail,
      service: new MenuProductionsService(
        menuProductionModel as never,
        {} as never,
        {} as never,
        {} as never,
        notifications as never,
        workflowMail as never,
      ),
    };
  };

  it('keeps an approved menu out of Storekeeper while its batch is pending', async () => {
    const updated = {
      _id: 'menu-1',
      productionCode: 'MPR0038',
      menuName: 'Soup',
      site: 'S001',
      createdBy: 'chef-1',
      approvalStatus: 'approved',
    };
    const {
      findOneAndUpdate,
      notifications,
      service,
      updateMany,
      workflowMail,
    } = makeService(updated, [
      updated,
      {
        _id: 'menu-2',
        productionCode: 'MPR0038',
        menuName: 'Rice',
        site: 'S001',
        createdBy: 'chef-1',
        approvalStatus: 'pending',
      },
    ]);

    await service.setApprovalStatus(
      'menu-1',
      'approved',
      'S001',
      'Unit Manager',
      '507f1f77bcf86cd799439011',
    );

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          approvalStatus: 'approved',
          storeRequestStatus: 'not-requested',
        }),
      }),
      { new: true },
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(notifications.createHierarchicalNotification).not.toHaveBeenCalled();
    expect(notifications.markRoleNotificationsAsRead).not.toHaveBeenCalled();
    expect(
      workflowMail.notifyMenuProductionBatchReviewed,
    ).not.toHaveBeenCalled();
  });

  it('returns the whole batch to Chef when any reviewed menu is rejected', async () => {
    const updated = {
      _id: 'menu-2',
      productionCode: 'MPR0038',
      menuName: 'Rice',
      site: 'S001',
      createdBy: 'chef-1',
      approvalStatus: 'rejected',
    };
    const reviewedBatch = [
      {
        _id: 'menu-1',
        productionCode: 'MPR0038',
        menuName: 'Soup',
        site: 'S001',
        createdBy: 'chef-1',
        approvalStatus: 'approved',
      },
      updated,
    ];
    const { notifications, service, updateMany, workflowMail } = makeService(
      updated,
      reviewedBatch,
    );

    const result = await service.setApprovalStatus(
      'menu-2',
      'rejected',
      'S001',
      'Unit Manager',
      '507f1f77bcf86cd799439011',
      'Recipe needs correction',
    );

    expect(updateMany).toHaveBeenCalledWith(
      { productionCode: 'MPR0038', site: 'S001' },
      expect.objectContaining({
        $set: { storeRequestStatus: 'not-requested' },
      }),
    );
    expect(notifications.createHierarchicalNotification).toHaveBeenCalledTimes(
      1,
    );
    expect(notifications.createHierarchicalNotification).toHaveBeenCalledWith(
      'system',
      'Menu Production Returned',
      expect.stringContaining('not forwarded to Storekeeper'),
      'S001',
      'chef',
      'STORE_REQUEST_RECORDS',
      { productionCode: 'MPR0038' },
    );
    expect(workflowMail.notifyMenuProductionBatchReviewed).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ approvalStatus: 'approved' }),
        expect.objectContaining({ approvalStatus: 'rejected' }),
      ]),
    );
    expect(result.storeRequestStatus).toBe('not-requested');
  });

  it('forwards the batch to Storekeeper only when every menu is approved', async () => {
    const updated = {
      _id: 'menu-2',
      productionCode: 'MPR0038',
      menuName: 'Rice',
      site: 'S001',
      createdBy: 'chef-1',
      approvalStatus: 'approved',
    };
    const { notifications, service, updateMany } = makeService(updated, [
      {
        _id: 'menu-1',
        productionCode: 'MPR0038',
        menuName: 'Soup',
        site: 'S001',
        createdBy: 'chef-1',
        approvalStatus: 'approved',
      },
      updated,
    ]);

    const result = await service.setApprovalStatus(
      'menu-2',
      'approved',
      'S001',
      'Unit Manager',
      '507f1f77bcf86cd799439011',
    );

    expect(updateMany).toHaveBeenCalledWith(
      { productionCode: 'MPR0038', site: 'S001' },
      { $set: { storeRequestStatus: 'requested' } },
    );
    expect(notifications.createHierarchicalNotification).toHaveBeenCalledWith(
      'chef-1',
      'New Store Request Dispatched',
      expect.stringContaining('All 2 menus'),
      'S001',
      'storekeeper',
      'STORE_REQUEST_STOREKEEPER',
      { productionCode: 'MPR0038' },
    );
    expect(result.storeRequestStatus).toBe('requested');
  });
});

describe('MenuProductionsService rejected menu replacement', () => {
  const oldRecipeId = '507f1f77bcf86cd799439011';
  const replacementRecipeId = '507f1f77bcf86cd799439012';
  const chefId = '507f1f77bcf86cd799439013';

  it('replaces only the Chef rejected menu and returns it to pending review', async () => {
    const existing = {
      _id: 'menu-1',
      recipeId: oldRecipeId,
      productionCode: 'MPR0038',
      productionDate: '2026-09-07',
      portion: 100,
      site: 'S001',
      createdBy: chefId,
      approvalStatus: 'rejected',
      sellingPricePerPax: 25000,
      sellingQuantity: 100,
      estimatedRevenue: 2500000,
      salesInputBy: 'Admin Site',
    };
    const replacementRecipe = {
      _id: replacementRecipeId,
      recipeCode: 'RCP0027',
      version: 2,
      name: 'Replacement Soup',
      category: 'Asian',
      portionSize: 10,
      ingredients: [
        {
          productCode: 'IT0001',
          name: 'Ingredient',
          unitOfMeasures: 'KG',
          qty: 2,
          priceUom: 50000,
        },
      ],
    };
    const menuFindOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(existing),
    });
    const updated = {
      ...existing,
      recipeId: replacementRecipeId,
      portion: 120,
      recipeCode: 'RCP0027',
      recipeVersion: 2,
      menuName: 'Replacement Soup',
      category: 'Asian',
      approvalStatus: 'pending',
      storeRequestStatus: 'not-requested',
    };
    const findOneAndUpdate = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(updated),
    });
    const revisedBatch = [
      updated,
      { ...updated, _id: 'menu-2', menuName: 'Replacement Rice' },
      { ...updated, _id: 'menu-3', menuName: 'Replacement Noodles' },
    ];
    const menuFind = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(revisedBatch),
    });
    const recipeFind = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([replacementRecipe]),
      }),
    });
    const notifications = {
      createHierarchicalNotification: jest.fn().mockResolvedValue(undefined),
    };
    const workflowMail = {
      notifyMenuProductionsSubmitted: jest.fn().mockResolvedValue(undefined),
    };
    const service = new MenuProductionsService(
      { findOne: menuFindOne, findOneAndUpdate, find: menuFind } as never,
      {} as never,
      { find: recipeFind } as never,
      {} as never,
      notifications as never,
      workflowMail as never,
    );

    const result = await service.changeRejectedMenu(
      'menu-1',
      {
        recipeId: replacementRecipeId,
        group: 'Indo 2',
        portion: 120,
        ingredientVendors: [
          {
            ingredientIndex: 0,
            productCode: 'IT0001',
            name: 'Ingredient',
            unitOfMeasures: 'KG',
            vendor: 'Vendor A',
            site: 'S001',
            price: 60000,
          },
        ],
      },
      chefId,
      'S001',
    );

    const expectedFilter = {
      _id: 'menu-1',
      createdBy: chefId,
      approvalStatus: 'rejected',
      isDraft: { $ne: true },
      site: 'S001',
    };
    expect(menuFindOne).toHaveBeenCalledWith(expectedFilter);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expectedFilter,
      expect.objectContaining({
        $set: expect.objectContaining({
          recipeId: replacementRecipeId,
          recipeCode: 'RCP0027',
          recipeVersion: 2,
          menuName: 'Replacement Soup',
          category: 'Asian',
          group: 'Indo 2',
          portion: 120,
          estimatedTotalCost: 1440000,
          estimatedCostPerPax: 12000,
          ingredientVendors: [
            expect.objectContaining({
              ingredientIndex: 0,
              vendor: 'Vendor A',
              site: 'S001',
              price: 60000,
            }),
          ],
          approvalStatus: 'pending',
          storeRequestStatus: 'not-requested',
        }),
        $unset: expect.objectContaining({
          rejectionReason: 1,
          reviewedBy: 1,
          approvedAt: 1,
          sellingPricePerPax: 1,
          sellingQuantity: 1,
          estimatedRevenue: 1,
          salesInputBy: 1,
        }),
      }),
      { new: true },
    );
    expect(result).toEqual(updated);
    expect(menuFind).toHaveBeenCalledWith({
      productionCode: 'MPR0038',
      createdBy: chefId,
      isDraft: { $ne: true },
      site: 'S001',
    });
    expect(notifications.createHierarchicalNotification).toHaveBeenCalledWith(
      chefId,
      'New Menu Production Sales Input',
      expect.stringContaining('awaiting selling price'),
      'S001',
      'admin-site',
      'ADMIN_SITE_MENU_PRODUCTION_SALES',
      { productionCode: 'MPR0038' },
    );
    expect(notifications.createHierarchicalNotification).toHaveBeenCalledTimes(
      1,
    );
    expect(workflowMail.notifyMenuProductionsSubmitted).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'menu-1',
          productionCode: 'MPR0038',
          approvalStatus: 'pending',
        }),
      ]),
      expect.stringMatching(/^replacement-batch-MPR0038-/),
    );
    expect(workflowMail.notifyMenuProductionsSubmitted).toHaveBeenCalledTimes(
      1,
    );
  });

  it('waits for every rejected menu in the MPR to be replaced before notifying Admin Site', async () => {
    const existing = {
      _id: 'menu-1',
      recipeId: oldRecipeId,
      productionCode: 'MPR0038',
      productionDate: '2026-09-07',
      portion: 100,
      site: 'S001',
      createdBy: chefId,
      approvalStatus: 'rejected',
    };
    const replacementRecipe = {
      _id: replacementRecipeId,
      recipeCode: 'RCP0027',
      version: 2,
      name: 'Replacement Soup',
      category: 'Asian',
      portionSize: 10,
      ingredients: [
        {
          productCode: 'IT0001',
          name: 'Ingredient',
          unitOfMeasures: 'KG',
          qty: 2,
          priceUom: 50000,
        },
      ],
    };
    const updated = {
      ...existing,
      recipeId: replacementRecipeId,
      approvalStatus: 'pending',
    };
    const menuFindOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(existing),
    });
    const findOneAndUpdate = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(updated),
    });
    const menuFind = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        updated,
        {
          ...existing,
          _id: 'menu-2',
          approvalStatus: 'rejected',
        },
      ]),
    });
    const recipeFind = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([replacementRecipe]),
      }),
    });
    const notifications = {
      createHierarchicalNotification: jest.fn().mockResolvedValue(undefined),
    };
    const workflowMail = {
      notifyMenuProductionsSubmitted: jest.fn().mockResolvedValue(undefined),
    };
    const service = new MenuProductionsService(
      { findOne: menuFindOne, findOneAndUpdate, find: menuFind } as never,
      {} as never,
      { find: recipeFind } as never,
      {} as never,
      notifications as never,
      workflowMail as never,
    );

    await service.changeRejectedMenu(
      'menu-1',
      {
        recipeId: replacementRecipeId,
        group: 'Indo 2',
        portion: 120,
        ingredientVendors: [
          {
            ingredientIndex: 0,
            productCode: 'IT0001',
            name: 'Ingredient',
            unitOfMeasures: 'KG',
            vendor: 'Vendor A',
            site: 'S001',
            price: 60000,
          },
        ],
      },
      chefId,
      'S001',
    );

    expect(notifications.createHierarchicalNotification).not.toHaveBeenCalled();
    expect(workflowMail.notifyMenuProductionsSubmitted).not.toHaveBeenCalled();
  });

  it('does not expose another Chef rejected menu for replacement', async () => {
    const menuFindOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    const service = new MenuProductionsService(
      { findOne: menuFindOne } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.changeRejectedMenu(
        'menu-1',
        {
          recipeId: replacementRecipeId,
          group: 'Indo 2',
          portion: 100,
          ingredientVendors: [],
        },
        chefId,
        'S001',
      ),
    ).rejects.toThrow(NotFoundException);

    expect(menuFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'menu-1',
        createdBy: chefId,
        approvalStatus: 'rejected',
        site: 'S001',
      }),
    );
  });
});
