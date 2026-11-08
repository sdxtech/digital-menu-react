import { BadRequestException, ConflictException } from '@nestjs/common';
import { MenuProductionsService } from './menu-productions.service';
import { productionBatchPagePipeline } from './production-batch-page';
import type { MenuProduction } from './schemas/menu-production.schema';
import type { SitesService } from '../sites/sites.service';
import type { PipelineStage } from 'mongoose';

const ids = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];
const makeMenus = (): (MenuProduction & { _id: string })[] =>
  ids.map((_id) => ({
    _id,
    productionCode: 'MPR0001',
    productionDate: '2026-11-08',
    site: 'S001',
    menuName: 'Rice',
    category: 'Main',
    portion: 100,
    cost: 1000,
    isDraft: false,
    createdBy: 'chef-1',
    unitManagerId: 'manager-1',
    approvalStatus: 'approved',
    salesApprovalStatus: 'approved',
    storeRequestStatus: 'not-requested',
    sellingPricePerPax: 10000,
    sellingQuantity: 100,
    financeApprovalRequired: true,
    financeControllerIds: ['controller-1'],
    financeCostStatus: 'pending',
    financeSalesStatus: 'pending',
  }));

const makeService = (
  menus = makeMenus(),
  sites?: Pick<
    SitesService,
    'findSummariesByCodes' | 'findFinanceControllerSites'
  >,
) => {
  const query = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockImplementation(() => Promise.resolve(menus)),
  };
  const model = {
    aggregate: jest
      .fn<Promise<unknown[]>, [PipelineStage[]]>()
      .mockResolvedValue([{ items: [], total: [], clients: [] }]),
    find: jest.fn().mockReturnValue(query),
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockImplementation(() => Promise.resolve(menus.at(-1))),
    }),
    countDocuments: jest.fn().mockResolvedValue(menus.length),
    findOneAndUpdate: jest
      .fn()
      .mockImplementation(
        (_filter: unknown, update: { $set: Partial<MenuProduction> }) => ({
          lean: () =>
            Promise.resolve(Object.assign(menus.at(-1)!, update.$set)),
        }),
      ),
    updateMany: jest
      .fn()
      .mockImplementation(
        (
          filter: Record<string, unknown>,
          update: { $set?: Partial<MenuProduction> },
        ) => {
          const matching =
            typeof filter.financeApprovalRequired === 'object'
              ? menus.filter(
                  (menu) =>
                    menu.site === filter.site &&
                    !menu.isDraft &&
                    menu.storeRequestStatus === 'not-requested' &&
                    !menu.financeApprovalRequired &&
                    !menu.storeFulfillmentCompletedAt &&
                    !menu.storeFulfillmentItems?.length &&
                    (!filter.productionCode ||
                      menu.productionCode === filter.productionCode) &&
                    (!filter._id || menu._id === filter._id),
                )
              : menus;
          matching.forEach((menu) => Object.assign(menu, update.$set));
          return Promise.resolve({ matchedCount: matching.length });
        },
      ),
  };
  const notifications = {
    createHierarchicalNotification: jest.fn().mockResolvedValue(undefined),
    markRoleNotificationsAsRead: jest.fn().mockResolvedValue(undefined),
  };
  const mail = {
    notifyMenuProductionsReadyForApproval: jest
      .fn()
      .mockResolvedValue(undefined),
    notifyMenuProductionBatchReviewed: jest.fn().mockResolvedValue(undefined),
  };
  const service = new MenuProductionsService(
    model as never,
    {} as never,
    {} as never,
    {} as never,
    notifications as never,
    mail as never,
    {} as never,
    sites as SitesService | undefined,
  );
  return { service, model, menus, mail, notifications };
};

const approveLastMenu = (service: MenuProductionsService) =>
  service.setApprovalStatus(ids[1], 'approved', 'S001', 'Manager');

const makeFinanceSites = (enabled = true, assignedSites = ['S001']) => ({
  findFinanceControllerSites: jest.fn().mockResolvedValue(assignedSites),
  findSummariesByCodes: jest.fn().mockResolvedValue(
    new Map([
      [
        'S001',
        {
          code: 'S001',
          name: 'Site One',
          financeApprovalEnabled: enabled,
          financeControllerIds: ['controller-1'],
        },
      ],
    ]),
  ),
});

const makeLegacyMenus = () =>
  makeMenus().map((menu) => {
    menu.financeApprovalRequired = false;
    menu.financeControllerIds = [];
    delete menu.financeCostStatus;
    delete menu.financeSalesStatus;
    return menu;
  });

describe('Finance enabled after Chef submission', () => {
  it('enrolls the complete partially approved batch before final recipe approval', async () => {
    const menus = makeLegacyMenus();
    menus[1].approvalStatus = 'pending';
    const { service, mail } = makeService(menus, makeFinanceSites());
    await approveLastMenu(service);
    expect(
      menus.every(
        (menu) =>
          menu.financeApprovalRequired &&
          menu.financeControllerIds?.includes('controller-1') &&
          menu.financeCostStatus === 'pending' &&
          menu.financeSalesStatus === 'pending' &&
          menu.storeRequestStatus === 'not-requested',
      ),
    ).toBe(true);
    expect(mail.notifyMenuProductionsReadyForApproval).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringMatching(/^manager-review-/),
      ['controller-1'],
    );
    await service.reviewFinanceBatch(
      ids,
      'approved',
      'controller-1',
      'Finance',
    );
    expect(menus.every((menu) => menu.storeRequestStatus === 'requested')).toBe(
      true,
    );
  });

  it('waits for separate sales approval when all recipes were already approved', async () => {
    const menus = makeLegacyMenus();
    menus.forEach((menu) => {
      menu.salesApprovalStatus = 'pending';
    });
    const { service, mail } = makeService(menus, makeFinanceSites());
    await service.approveSalesBatch(ids, 'S001', {
      id: 'manager-1',
      name: 'Manager',
    });
    expect(
      menus.every(
        (menu) =>
          menu.financeApprovalRequired &&
          menu.storeRequestStatus === 'not-requested',
      ),
    ).toBe(true);
    expect(mail.notifyMenuProductionsReadyForApproval).toHaveBeenCalled();
  });

  it('keeps the original flow when site Finance approval is disabled', async () => {
    const menus = makeLegacyMenus();
    menus[1].approvalStatus = 'pending';
    const { service } = makeService(menus, makeFinanceSites(false));
    await approveLastMenu(service);
    expect(
      menus.every(
        (menu) =>
          !menu.financeApprovalRequired &&
          menu.storeRequestStatus === 'requested',
      ),
    ).toBe(true);
  });

  it('enrolls already approved undispatched MPRs when loading the Finance queue', async () => {
    const menus = makeLegacyMenus();
    const { service, model } = makeService(menus, makeFinanceSites());
    await service.buildStoreRequestGroups(
      { view: 'finance-approval', summaryOnly: true },
      undefined,
      undefined,
      false,
      'controller-1',
    );
    expect(menus.every((menu) => menu.financeApprovalRequired)).toBe(true);
    expect(model.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        site: 'S001',
        isDraft: { $ne: true },
        storeRequestStatus: 'not-requested',
        financeApprovalRequired: { $ne: true },
        storeFulfillmentCompletedAt: { $exists: false },
        'storeFulfillmentItems.0': { $exists: false },
      }),
      expect.any(Object),
    );
  });

  it.each(['requested', 'fulfilled', 'cancelled'] as const)(
    'does not require retroactive Finance approval for %s MPRs',
    async (status) => {
      const menus = makeLegacyMenus();
      menus.forEach((menu) => {
        menu.storeRequestStatus = status;
      });
      const before = structuredClone(menus);
      const { service } = makeService(menus, makeFinanceSites());
      await service.buildStoreRequestGroups(
        { view: 'finance-approval', summaryOnly: true },
        undefined,
        undefined,
        false,
        'controller-1',
      );
      expect(menus).toEqual(before);
    },
  );

  it('preserves existing Finance decisions and excludes drafts and other sites', async () => {
    const menus = [...makeLegacyMenus(), ...makeMenus()];
    menus[0].isDraft = true;
    menus[1].site = 'S002';
    menus[2].financeCostStatus = 'approved';
    menus[2].financeSalesStatus = 'approved';
    const before = structuredClone(menus);
    const { service } = makeService(menus, makeFinanceSites());
    await service.buildStoreRequestGroups(
      { view: 'finance-approval', summaryOnly: true },
      undefined,
      undefined,
      false,
      'controller-1',
    );
    expect(menus).toEqual(before);
  });

  it('blocks the direct Storekeeper dispatch endpoint for newly required Finance', async () => {
    const menus = makeLegacyMenus();
    const { service, model } = makeService(menus, makeFinanceSites());
    model.findOne.mockReturnValue(menus[0]);
    await expect(
      service.setStoreRequestStatus(ids[0], 'requested', 'S001'),
    ).rejects.toThrow('Finance approval is not complete');
    expect(menus[0].storeRequestStatus).toBe('not-requested');
  });

  it('lists current assigned sites even without any MPR snapshot', async () => {
    const { service } = makeService([], makeFinanceSites());
    await expect(service.financeSites('controller-1')).resolves.toEqual([
      { code: 'S001', name: 'Site One' },
    ]);
  });

  it('allows legacy history by current site assignment without changing its approval data', async () => {
    const menus = makeLegacyMenus();
    menus.forEach((menu) => {
      menu.storeRequestStatus = 'requested';
    });
    const { service, model } = makeService(menus, makeFinanceSites());
    await service.buildStoreRequestGroups(
      { view: 'records-all', summaryOnly: true },
      'S001',
      undefined,
      false,
      'controller-1',
    );
    expect(model.aggregate.mock.calls[0][0][0]).toEqual({
      $match: {
        isDraft: { $ne: true },
        $and: [{ site: { $in: ['S001'] } }, { site: 'S001' }],
      },
    });
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('restricts history to current assigned sites even when an old MPR names the controller', async () => {
    const { service, model } = makeService(
      makeMenus(),
      makeFinanceSites(true, []),
    );
    await service.buildStoreRequestGroups(
      { view: 'records-all', summaryOnly: true },
      'S001',
      undefined,
      false,
      'controller-1',
    );
    expect(model.aggregate.mock.calls[0][0][0]).toEqual({
      $match: {
        isDraft: { $ne: true },
        $and: [{ site: { $in: [] } }, { site: 'S001' }],
      },
    });
    await expect(
      service.reviewFinanceBatch(ids, 'approved', 'controller-1', 'Finance'),
    ).rejects.toThrow(ConflictException);
    expect(model.updateMany).not.toHaveBeenCalled();
  });
});

describe('Unit Manager then Finance batch approval', () => {
  it('requires a separate sales approval even after every recipe is approved', async () => {
    const { service, menus, mail, notifications } = makeService();
    menus.forEach((menu) => {
      menu.salesApprovalStatus = 'pending';
    });
    menus[1].approvalStatus = 'pending';
    await approveLastMenu(service);
    expect(mail.notifyMenuProductionsReadyForApproval).not.toHaveBeenCalled();
    expect(mail.notifyMenuProductionBatchReviewed).not.toHaveBeenCalled();
    expect(notifications.createHierarchicalNotification).not.toHaveBeenCalled();
    expect(
      menus.every((menu) => menu.storeRequestStatus === 'not-requested'),
    ).toBe(true);
    await service.approveSalesBatch(ids, 'S001', {
      id: 'manager-1',
      name: 'Manager',
    });
    expect(menus.every((menu) => menu.salesApprovalStatus === 'approved')).toBe(
      true,
    );
    expect(mail.notifyMenuProductionsReadyForApproval).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringMatching(/^manager-review-/),
      ['controller-1'],
    );
  });

  it('allows sales approval while recipes are pending or rejected without changing their decisions', async () => {
    const { service, menus, notifications } = makeService();
    menus.forEach((menu) => {
      menu.salesApprovalStatus = 'pending';
    });
    menus[0].approvalStatus = 'rejected';
    menus[1].approvalStatus = 'pending';
    await service.approveSalesBatch(ids, 'S001', {
      id: 'manager-1',
      name: 'Manager',
    });
    expect(menus.map((menu) => menu.approvalStatus)).toEqual([
      'rejected',
      'pending',
    ]);
    expect(
      menus.every(
        (menu) =>
          menu.salesApprovalStatus === 'approved' &&
          menu.salesApprovedBy === 'Manager',
      ),
    ).toBe(true);
    expect(notifications.createHierarchicalNotification).not.toHaveBeenCalled();
  });

  it('dispatches a site without Finance only after the separate sales decision is approved', async () => {
    const { service, menus } = makeService();
    menus.forEach((menu) => {
      menu.salesApprovalStatus = 'pending';
      menu.financeApprovalRequired = false;
    });
    await service.approveSalesBatch(ids, 'S001', {
      id: 'manager-1',
      name: 'Manager',
    });
    expect(menus.every((menu) => menu.storeRequestStatus === 'requested')).toBe(
      true,
    );
  });

  it('keeps batches with only sales pending in the Unit Manager queue', () => {
    expect(
      productionBatchPagePipeline(
        {},
        { view: 'approval', approvalStatus: 'pending' },
      ),
    ).toContainEqual({
      $match: {
        $and: [
          {
            $or: [{ approvalStatuses: 'pending' }, { salesApprovalPending: 1 }],
          },
          { salesReady: 1 },
        ],
      },
    });
  });

  it('blocks direct Finance and Storekeeper actions while Unit Manager sales approval is pending', async () => {
    const { service, menus, model } = makeService();
    menus.forEach((menu) => {
      menu.salesApprovalStatus = 'pending';
    });
    await expect(
      service.reviewFinanceBatch(ids, 'approved', 'controller-1', 'Finance'),
    ).rejects.toThrow(ConflictException);
    model.findOne.mockReturnValueOnce(menus[0]);
    await expect(
      service.setStoreRequestStatus(ids[0], 'requested', 'S001'),
    ).rejects.toThrow('sales approval is not complete');
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate sales approval and incomplete batch selections', async () => {
    const { service, model } = makeService();
    await expect(
      service.approveSalesBatch(ids, 'S001', {
        id: 'manager-1',
        name: 'Manager',
      }),
    ).rejects.toThrow('already approved');
    await expect(
      service.approveSalesBatch([ids[0]], 'S001', {
        id: 'manager-1',
        name: 'Manager',
      }),
    ).rejects.toThrow();
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('does not forward the MPR if sales change during approval', async () => {
    const { service, model, menus, notifications } = makeService();
    menus.forEach((menu) => {
      menu.salesApprovalStatus = 'pending';
    });
    model.updateMany.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(
      service.approveSalesBatch(ids, 'S001', {
        id: 'manager-1',
        name: 'Manager',
      }),
    ).rejects.toThrow('MPR changed');
    expect(notifications.createHierarchicalNotification).not.toHaveBeenCalled();
    expect(model.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: ids.map((_id) => ({
          _id,
          sellingPricePerPax: 10000,
          sellingQuantity: 100,
          groupSales: { $exists: false },
        })),
      }),
      expect.any(Object),
    );
  });

  it('retains already completed approvals on legacy records without a separate sales status', async () => {
    const { service, menus } = makeService();
    menus.forEach((menu) => {
      delete menu.salesApprovalStatus;
    });
    await service.reviewFinanceBatch(
      ids,
      'approved',
      'controller-1',
      'Finance',
    );
    expect(menus.every((menu) => menu.storeRequestStatus === 'requested')).toBe(
      true,
    );
  });
  it('requires manager approval for every menu before listing a Finance batch', () => {
    expect(
      productionBatchPagePipeline({}, { view: 'finance-approval' }),
    ).toContainEqual({
      $match: {
        $and: [
          {
            financePending: 1,
            salesReady: 1,
            managerApproved: 1,
            storeOpen: 1,
          },
        ],
      },
    });
    expect(
      productionBatchPagePipeline({}, { view: 'approval' }),
    ).toContainEqual({
      $match: { $and: [{ salesReady: 1 }] },
    });
  });

  it('allows manager review while Finance is pending and forwards only to Finance', async () => {
    const { service, menus, mail, notifications } = makeService();
    menus[1].approvalStatus = 'pending';
    await approveLastMenu(service);
    expect(
      menus.every((menu) => menu.storeRequestStatus === 'not-requested'),
    ).toBe(true);
    expect(mail.notifyMenuProductionsReadyForApproval).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringMatching(/^manager-review-/),
      ['controller-1'],
    );
    expect(mail.notifyMenuProductionBatchReviewed).not.toHaveBeenCalled();
    expect(
      notifications.createHierarchicalNotification.mock.calls.some(
        (call: unknown[]) => call[4] === 'storekeeper',
      ),
    ).toBe(false);
  });

  it('holds a partially reviewed batch for the remaining manager decisions', async () => {
    const { service, menus, mail } = makeService();
    menus.forEach((menu) => {
      menu.approvalStatus = 'pending';
    });
    await approveLastMenu(service);
    expect(mail.notifyMenuProductionsReadyForApproval).not.toHaveBeenCalled();
    expect(
      menus.every((menu) => menu.storeRequestStatus === 'not-requested'),
    ).toBe(true);
  });

  it.each(['no-finance', 'legacy-approved'])(
    'forwards %s batches to Storekeeper after manager approval',
    async (kind) => {
      const { service, menus, mail } = makeService();
      menus.forEach((menu) => {
        menu.financeApprovalRequired = kind !== 'no-finance';
        if (kind === 'legacy-approved') {
          menu.financeCostStatus = 'approved';
          menu.financeSalesStatus = 'approved';
        }
      });
      menus[1].approvalStatus = 'pending';
      await approveLastMenu(service);
      expect(
        menus.every((menu) => menu.storeRequestStatus === 'requested'),
      ).toBe(true);
      expect(mail.notifyMenuProductionBatchReviewed).toHaveBeenCalled();
      expect(mail.notifyMenuProductionsReadyForApproval).not.toHaveBeenCalled();
    },
  );

  it('approves the complete batch and releases it to Storekeeper', async () => {
    const { service, menus, mail } = makeService();
    await expect(
      service.reviewFinanceBatch(ids, 'approved', 'controller-1', 'Finance'),
    ).resolves.toEqual({ updatedCount: 2 });
    expect(
      menus.every(
        (menu) =>
          menu.financeCostStatus === 'approved' &&
          menu.financeSalesStatus === 'approved' &&
          menu.storeRequestStatus === 'requested',
      ),
    ).toBe(true);
    expect(mail.notifyMenuProductionBatchReviewed).toHaveBeenCalled();
  });

  it('returns Finance feedback to the manager without rejecting recipes or sales', async () => {
    const { service, menus, notifications, mail } = makeService();
    await service.reviewFinanceBatch(
      ids,
      'rejected',
      'controller-1',
      'Finance',
      'Please check the rice cost and sales pax.',
    );
    expect(
      menus.every(
        (menu) =>
          menu.approvalStatus === 'pending' &&
          menu.storeRequestStatus === 'not-requested' &&
          !menu.rejectionReason &&
          !menu.salesRejectionReason &&
          menu.sellingQuantity === 100,
      ),
    ).toBe(true);
    expect(menus[0].financeReviewReason).toContain('rice cost');
    expect(notifications.createHierarchicalNotification).toHaveBeenCalledWith(
      'controller-1',
      expect.any(String),
      expect.stringContaining('rice cost'),
      'S001',
      'unit.manager',
      'MENU_PRODUCTION_APPROVAL_REQUESTS',
      expect.any(Object),
    );
    expect(mail.notifyMenuProductionsReadyForApproval).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          financeReviewReason: expect.stringContaining('rice cost'),
        }),
      ]),
      expect.stringMatching(/^finance-return-/),
    );
    expect(mail.notifyMenuProductionBatchReviewed).not.toHaveBeenCalled();
  });

  it('emails the new feedback even when the loaded records are unchanged snapshots', async () => {
    const { service, model, mail } = makeService();
    model.updateMany.mockResolvedValueOnce({ matchedCount: 2 });
    await service.reviewFinanceBatch(
      ids,
      'rejected',
      'controller-1',
      'Finance',
      'Check the sales pax.',
    );
    expect(mail.notifyMenuProductionsReadyForApproval).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          financeReviewReason: 'Check the sales pax.',
        }),
      ]),
      expect.stringMatching(/^finance-return-/),
    );
  });

  it('lets the manager return a recipe to Chef after Finance feedback', async () => {
    const { service, menus, notifications, mail } = makeService();
    menus.forEach((menu) => {
      menu.financeCostStatus = 'rejected';
      menu.financeSalesStatus = 'rejected';
    });
    menus[1].approvalStatus = 'pending';
    await service.setApprovalStatus(
      ids[1],
      'rejected',
      'S001',
      'Manager',
      undefined,
      'Revise the recipe portion.',
    );
    expect(menus[1].rejectionReason).toBe('Revise the recipe portion.');
    expect(notifications.createHierarchicalNotification).toHaveBeenCalledWith(
      'system',
      'Menu Production Returned',
      expect.any(String),
      'S001',
      'chef',
      'STORE_REQUEST_RECORDS',
      expect.any(Object),
    );
    expect(mail.notifyMenuProductionsReadyForApproval).not.toHaveBeenCalled();
  });

  it('lets the manager return sales to Admin and invalidates Finance approval for the correction', async () => {
    const { service, menus, notifications } = makeService();
    await service.reviewFinanceBatch(
      ids,
      'rejected',
      'controller-1',
      'Finance',
      'Check the sales pax.',
    );
    await service.rejectSalesBatch(
      { menuProductionIds: ids, reason: 'Revise sales pax.' },
      'S001',
      { id: 'manager-1', name: 'Manager' },
    );
    expect(
      menus.every(
        (menu) =>
          menu.financeCostStatus === 'pending' &&
          menu.financeSalesStatus === 'pending' &&
          menu.salesRejectionReason === 'Revise sales pax.',
      ),
    ).toBe(true);
    expect(
      notifications.createHierarchicalNotification,
    ).toHaveBeenLastCalledWith(
      'manager-1',
      'Sales Correction Required',
      expect.any(String),
      'S001',
      'admin-site',
      'ADMIN_SITE_MENU_PRODUCTION_SALES',
      expect.any(Object),
    );
  });

  it('requires another Finance review even when the manager approves without revisions', async () => {
    const { service, menus, mail } = makeService();
    await service.reviewFinanceBatch(
      ids,
      'rejected',
      'controller-1',
      'Finance',
      'Check food cost.',
    );
    menus[0].approvalStatus = 'approved';
    await approveLastMenu(service);
    await service.approveSalesBatch(ids, 'S001', {
      id: 'manager-1',
      name: 'Manager',
    });
    expect(
      menus.every(
        (menu) =>
          menu.financeCostStatus === 'pending' &&
          menu.financeSalesStatus === 'pending' &&
          menu.storeRequestStatus === 'not-requested',
      ),
    ).toBe(true);
    expect(mail.notifyMenuProductionsReadyForApproval).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.stringMatching(/^manager-review-/),
      ['controller-1'],
    );
    await service.reviewFinanceBatch(
      ids,
      'approved',
      'controller-1',
      'Finance',
    );
    expect(menus.every((menu) => menu.storeRequestStatus === 'requested')).toBe(
      true,
    );
  });

  it.each([
    'unassigned',
    'manager-pending',
    'completed',
    'sales-missing',
    'already-approved',
  ])('blocks invalid Finance review: %s', async (kind) => {
    const { service, menus, model } = makeService();
    if (kind === 'unassigned')
      menus[1].financeControllerIds = ['other-controller'];
    if (kind === 'manager-pending') menus[1].approvalStatus = 'pending';
    if (kind === 'completed') menus[1].storeRequestStatus = 'fulfilled';
    if (kind === 'sales-missing') menus[1].sellingQuantity = undefined;
    if (kind === 'already-approved')
      menus.forEach((menu) => {
        menu.financeCostStatus = 'approved';
        menu.financeSalesStatus = 'approved';
      });
    await expect(
      service.reviewFinanceBatch(ids, 'approved', 'controller-1', 'Finance'),
    ).rejects.toThrow(ConflictException);
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('allows a completed manager review with stale Finance rejection statuses to return to Finance', async () => {
    const { service, menus } = makeService();
    menus[0].financeCostStatus = 'rejected';
    menus[0].financeSalesStatus = 'rejected';
    menus[0].financeReviewReason = 'Check food cost.';
    await service.reviewFinanceBatch(
      ids,
      'approved',
      'controller-1',
      'Finance',
    );
    expect(menus.every((menu) => menu.storeRequestStatus === 'requested')).toBe(
      true,
    );
  });

  it('rejects incomplete selections and missing reasons before changing a batch', async () => {
    const { service, model } = makeService();
    await expect(
      service.reviewFinanceBatch(
        [ids[0]],
        'approved',
        'controller-1',
        'Finance',
      ),
    ).rejects.toThrow();
    await expect(
      service.reviewFinanceBatch(
        ids,
        'rejected',
        'controller-1',
        'Finance',
        '  ',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('does not dispatch a batch if it changes during review', async () => {
    const { service, model, mail } = makeService();
    model.updateMany.mockResolvedValueOnce({ matchedCount: 1 });
    await expect(
      service.reviewFinanceBatch(ids, 'approved', 'controller-1', 'Finance'),
    ).rejects.toThrow(ConflictException);
    expect(mail.notifyMenuProductionBatchReviewed).not.toHaveBeenCalled();
  });

  it('blocks the old per-menu and sales Finance endpoints', async () => {
    const { service, model } = makeService();
    await expect(
      service.reviewFinanceCost(
        ids[0],
        'rejected',
        'controller-1',
        'Finance',
        'Cost',
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.reviewFinanceSales(ids, 'approved', 'controller-1', 'Finance'),
    ).rejects.toThrow(ConflictException);
    expect(model.updateMany).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('blocks direct store requests while Finance is pending', async () => {
    const { service, model, menus } = makeService();
    model.findOne.mockReturnValueOnce(menus[0]);
    await expect(
      service.setStoreRequestStatus(ids[0], 'requested', 'S001'),
    ).rejects.toThrow('Finance approval is not complete');
  });

  it('blocks direct store requests until the remaining manager decisions are finished', async () => {
    const { service, model, menus } = makeService();
    menus.forEach((menu) => {
      menu.financeCostStatus = 'approved';
      menu.financeSalesStatus = 'approved';
    });
    model.findOne.mockReturnValueOnce(menus[0]);
    model.countDocuments.mockResolvedValueOnce(1);
    await expect(
      service.setStoreRequestStatus(ids[0], 'requested', 'S001'),
    ).rejects.toThrow('The complete batch must finish approval');
  });

  it('keeps batches awaiting Finance in production records', () => {
    expect(productionBatchPagePipeline({}, { view: 'records' })).toContainEqual(
      {
        $match: {
          $and: [
            {
              $or: [
                { storeStatuses: { $in: ['fulfilled', 'cancelled'] } },
                { approvalStatuses: 'rejected' },
                { approvedRequested: 1 },
                { managerApproved: 1, financeAwaiting: 1 },
              ],
            },
          ],
        },
      },
    );
  });
});
