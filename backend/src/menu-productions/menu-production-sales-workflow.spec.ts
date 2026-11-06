import { MenuProductionsService } from './menu-productions.service';

const ids = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];
const actor = { id: '507f1f77bcf86cd799439013', name: 'Unit Manager' };
const reason = 'Pax Calculation should be 150 and Sales/Pax should be 20000.';
const makeMenus = () =>
  ids.map((_id) => ({
    _id,
    productionCode: 'MPR0001',
    productionDate: '2026-10-27',
    site: 'S001',
    menuName: 'Rice',
    category: 'Main',
    portion: 100,
    isDraft: false,
    approvalStatus: 'approved',
    storeRequestStatus: 'requested',
    sellingPricePerPax: 10000,
    sellingQuantity: 50,
    estimatedRevenue: 500000,
  }));

const makeService = (menus: Array<Record<string, unknown>> = makeMenus()) => {
  const model = {
    find: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(menus) }),
    countDocuments: jest.fn().mockResolvedValue(menus.length),
    updateMany: jest.fn().mockResolvedValue({ matchedCount: menus.length }),
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(menus[0]),
    }),
    findOneAndUpdate: jest.fn(),
  };
  const notifications = {
    createHierarchicalNotification: jest.fn().mockResolvedValue(undefined),
  };
  const mail = {
    notifyMenuProductionsReadyForApproval: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  return {
    model,
    notifications,
    mail,
    service: new MenuProductionsService(
      model as never,
      {} as never,
      {} as never,
      {} as never,
      notifications as never,
      mail as never,
      { findVendorPrices: jest.fn().mockResolvedValue([]) } as never,
    ),
  };
};

describe('MPR sales correction workflow', () => {
  it('routes sales submission email to the assigned finance controllers', async () => {
    const menus = makeMenus().map((menu) => ({
      ...menu,
      approvalStatus: 'pending',
      financeApprovalRequired: true,
      financeControllerIds: [ids[0]],
    }));
    const { service, mail } = makeService(menus);
    await service.updateBatchSalesDetails(
      'MPR0001',
      {
        productionCode: 'MPR0001',
        sellingPricePerPax: 10000,
        sellingQuantity: 50,
      },
      'S001',
      'Admin',
    );
    expect(mail.notifyMenuProductionsReadyForApproval).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringMatching(/^sales-resubmission-/),
      [ids[0]],
    );
  });

  it('stores each group price and revenue, using the largest portion in each group', async () => {
    const menus = [
      {
        ...makeMenus()[0],
        group: 'Asian',
        portion: 100,
        approvalStatus: 'pending',
      },
      {
        ...makeMenus()[1],
        group: 'Asian',
        portion: 80,
        approvalStatus: 'pending',
      },
      {
        ...makeMenus()[1],
        group: 'Regular',
        portion: 50,
        approvalStatus: 'pending',
      },
    ];
    const { service, model } = makeService(menus);
    await service.updateBatchSalesDetails(
      'MPR0001',
      {
        productionCode: 'MPR0001',
        groupPrices: [
          { name: 'Asian', sellingPricePerPax: 20000 },
          { name: 'Regular', sellingPricePerPax: 30000 },
        ],
      },
      'S001',
      'Admin',
    );
    expect(model.updateMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          sellingQuantity: 150,
          estimatedRevenue: 3500000,
          groupSales: [
            {
              name: 'Asian',
              quantity: 100,
              sellingPricePerPax: 20000,
              estimatedRevenue: 2000000,
            },
            {
              name: 'Regular',
              quantity: 50,
              sellingPricePerPax: 30000,
              estimatedRevenue: 1500000,
            },
          ],
        }),
      }),
    );
  });

  it('rejects missing or duplicate group prices before saving', async () => {
    const { service, model } = makeService(
      makeMenus().map((menu, i) => ({
        ...menu,
        group: i ? 'Regular' : 'Asian',
      })),
    );
    await expect(
      service.updateBatchSalesDetails(
        'MPR0001',
        {
          productionCode: 'MPR0001',
          groupPrices: [{ name: 'Asian', sellingPricePerPax: 20000 }],
        },
        'S001',
        'Admin',
      ),
    ).rejects.toThrow('every menu group');
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('edits group prices without replacing them with a single price', async () => {
    const menus = makeMenus().map((menu, index) => ({
      ...menu,
      group: index ? 'Regular' : 'Asian',
      portion: index ? 50 : 100,
      groupSales: [
        {
          name: 'Asian',
          quantity: 100,
          sellingPricePerPax: 1,
          estimatedRevenue: 100,
        },
      ],
    }));
    const { service, model } = makeService(menus);
    await service.editSalesBatch(
      {
        menuProductionIds: ids,
        groupPrices: [
          { name: 'Asian', sellingPricePerPax: 20000 },
          { name: 'Regular', sellingPricePerPax: 30000 },
        ],
      },
      'S001',
      'Superadmin',
    );
    expect(model.updateMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          estimatedRevenue: 3500000,
          groupSales: expect.arrayContaining([
            expect.objectContaining({
              name: 'Asian',
              estimatedRevenue: 2000000,
            }),
            expect.objectContaining({
              name: 'Regular',
              estimatedRevenue: 1500000,
            }),
          ]),
        }),
      }),
    );
  });
  it('blocks direct approval while sales rejection instructions remain active even if numbers are present', async () => {
    const { service, model } = makeService(
      makeMenus().map((menu) => ({ ...menu, salesRejectionReason: reason })),
    );
    await expect(service.setApprovalStatus(ids[0], 'approved')).rejects.toThrow(
      'must be completed by Admin Site',
    );
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('excludes returned sales from the approval-ready inbox', async () => {
    const { service, model } = makeService([]);
    jest
      .spyOn(
        service as unknown as {
          backfillMissingMenuProductionCodes: () => Promise<void>;
        },
        'backfillMissingMenuProductionCodes',
      )
      .mockResolvedValue(undefined);
    model.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    await service.buildStoreRequestGroups({}, 'S001', undefined, true);
    const calls = model.find.mock.calls as unknown as Array<
      [{ $and: Array<Record<string, unknown>> }]
    >;
    expect(calls[0][0].$and).toContainEqual({
      salesRejectionReason: { $exists: false },
      sellingPricePerPax: { $type: 'number', $gte: 0 },
      sellingQuantity: { $type: 'number', $gte: 0 },
    });
  });

  it.each(['pending', 'approved', 'rejected'])(
    'edits %s sales without changing approval or production quantities',
    async (approvalStatus) => {
      const { service, model } = makeService(
        makeMenus().map((menu) => ({ ...menu, approvalStatus })),
      );
      await service.editSalesBatch(
        {
          menuProductionIds: ids,
          sellingPricePerPax: 20000,
          sellingQuantity: 150,
        },
        undefined,
        'Superadmin',
      );
      expect(model.updateMany).toHaveBeenCalledWith(expect.any(Object), {
        $set: {
          sellingPricePerPax: 20000,
          sellingQuantity: 150,
          estimatedRevenue: 3000000,
          salesInputBy: 'Superadmin',
        },
        $unset: {
          salesRejectionReason: 1,
          salesRejectedBy: 1,
          salesRejectedAt: 1,
        },
      });
    },
  );

  it('edits completed sales while preserving actual issuance and all operational statuses', async () => {
    const { service, model } = makeService(
      makeMenus().map((menu) => ({
        ...menu,
        storeRequestStatus: 'fulfilled',
        storeFulfillmentItems: [{ actualQty: 10 }],
      })),
    );
    await service.editSalesBatch(
      { menuProductionIds: ids, sellingPricePerPax: 0, sellingQuantity: 100 },
      'S001',
      'Superadmin',
    );
    const calls = model.updateMany.mock.calls as unknown as Array<
      [
        unknown,
        { $set: Record<string, unknown>; $unset: Record<string, unknown> },
      ]
    >;
    expect(calls[0][1].$set.estimatedRevenue).toBe(0);
    for (const field of [
      'approvalStatus',
      'storeRequestStatus',
      'portion',
      'storeFulfillmentItems',
      'approvedAt',
    ]) {
      expect(calls[0][1].$set).not.toHaveProperty(field);
      expect(calls[0][1].$unset).not.toHaveProperty(field);
    }
  });

  it.each(['pending', 'approved'])(
    'returns %s sales to Admin with instructions and requires a new UM approval',
    async (approvalStatus) => {
      const { service, model, notifications } = makeService(
        makeMenus().map((menu) => ({ ...menu, approvalStatus })),
      );
      await service.rejectSalesBatch(
        { menuProductionIds: ids, reason },
        'S001',
        actor,
        actor.id,
      );
      expect(model.find).toHaveBeenCalledWith({
        $and: [
          { _id: { $in: ids }, isDraft: { $ne: true }, site: 'S001' },
          {
            $or: [
              { unitManagerId: actor.id },
              { unitManagerId: { $exists: false } },
              { unitManagerId: '' },
              { unitManagerId: null },
            ],
          },
        ],
      });
      const updates = model.updateMany.mock.calls as unknown as Array<
        [
          Record<string, unknown>,
          { $set: Record<string, unknown>; $unset: Record<string, unknown> },
        ]
      >;
      expect(updates[0][0]).toMatchObject({
        _id: { $in: ids },
        storeRequestStatus: { $in: ['not-requested', 'requested'] },
      });
      expect(updates[0][1].$set).toMatchObject({
        approvalStatus: 'pending',
        storeRequestStatus: 'not-requested',
        salesRejectionReason: reason,
        salesRejectedBy: actor.name,
      });
      expect(updates[0][1].$set.salesRejectedAt).toBeInstanceOf(Date);
      expect(updates[0][1].$unset).toEqual({
        sellingPricePerPax: 1,
        sellingQuantity: 1,
        estimatedRevenue: 1,
        groupSales: 1,
        salesInputBy: 1,
        reviewedBy: 1,
        approvedAt: 1,
      });
      expect(notifications.createHierarchicalNotification).toHaveBeenCalledWith(
        actor.id,
        'Sales Correction Required',
        expect.stringContaining(reason),
        'S001',
        'admin-site',
        'ADMIN_SITE_MENU_PRODUCTION_SALES',
        { productionCode: 'MPR0001', reason },
      );
    },
  );

  it.each([
    { storeRequestStatus: 'fulfilled' },
    { storeRequestStatus: 'cancelled' },
    { storeFulfillmentCompletedAt: new Date() },
    { storeFulfillmentItems: [{ actualQty: 10 }] },
  ])('blocks Reject Sales after issuance or closure', async (state) => {
    const { service, model } = makeService(
      makeMenus().map((menu) => ({ ...menu, ...state })),
    );
    await expect(
      service.rejectSalesBatch(
        { menuProductionIds: ids, reason },
        undefined,
        actor,
      ),
    ).rejects.toThrow('cannot have sales rejected');
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { approvalStatus: 'rejected' },
    { salesRejectionReason: 'Already returned' },
    { sellingQuantity: undefined },
  ])(
    'does not mix menu rejection or unsubmitted sales with Reject Sales',
    async (state) => {
      const { service, model } = makeService(
        makeMenus().map((menu) => ({ ...menu, ...state })),
      );
      await expect(
        service.rejectSalesBatch(
          { menuProductionIds: ids, reason },
          undefined,
          actor,
        ),
      ).rejects.toThrow();
      expect(model.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects missing reasons, negative prices, and partial or cross-site batch selections', async () => {
    const { service, model } = makeService();
    await expect(
      service.rejectSalesBatch(
        { menuProductionIds: ids, reason: '   ' },
        undefined,
        actor,
      ),
    ).rejects.toThrow('rejection reason');
    await expect(
      service.editSalesBatch(
        {
          menuProductionIds: ids,
          sellingPricePerPax: -1,
          sellingQuantity: 100,
        },
        undefined,
        actor.name,
      ),
    ).rejects.toThrow('Valid sales values');
    model.countDocuments.mockResolvedValue(3);
    await expect(
      service.editSalesBatch(
        {
          menuProductionIds: ids,
          sellingPricePerPax: 10000,
          sellingQuantity: 100,
        },
        undefined,
        actor.name,
      ),
    ).rejects.toThrow('MPR has changed');
    expect(model.updateMany).not.toHaveBeenCalled();
    const otherSite = makeService(
      makeMenus().map((menu, index) => ({
        ...menu,
        site: index ? 'S002' : 'S001',
      })),
    );
    await expect(
      otherSite.service.rejectSalesBatch(
        { menuProductionIds: ids, reason },
        undefined,
        actor,
      ),
    ).rejects.toThrow('one complete MPR batch');
    expect(otherSite.model.updateMany).not.toHaveBeenCalled();
  });

  it('denies an unassigned reviewer when the scoped lookup cannot see the complete batch', async () => {
    const { service, model } = makeService([]);
    await expect(
      service.rejectSalesBatch(
        { menuProductionIds: ids, reason },
        'S001',
        actor,
        actor.id,
      ),
    ).rejects.toThrow('not assigned');
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a returned MPR out of approval until Admin resubmits both corrected values', async () => {
    const menus: Array<Record<string, unknown>> = makeMenus();
    const { service, model, mail } = makeService(menus);
    model.updateMany.mockImplementation(
      (
        _filter: unknown,
        update: {
          $set?: Record<string, unknown>;
          $unset?: Record<string, unknown>;
        },
      ) => {
        for (const menu of menus) {
          Object.assign(menu, update.$set);
          for (const field of Object.keys(update.$unset ?? {}))
            delete menu[field];
        }
        return Promise.resolve({ matchedCount: menus.length });
      },
    );
    await service.rejectSalesBatch(
      { menuProductionIds: ids, reason },
      undefined,
      actor,
    );
    expect(menus[0].salesRejectionReason).toBe(reason);
    expect(menus[0].sellingQuantity).toBeUndefined();
    await expect(service.setApprovalStatus(ids[0], 'approved')).rejects.toThrow(
      'must be completed by Admin Site',
    );
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    await service.updateBatchSalesDetails(
      'MPR0001',
      {
        productionCode: 'MPR0001',
        sellingPricePerPax: 20000,
        sellingQuantity: 150,
      },
      'S001',
      'Admin Sales',
    );
    expect(menus[0]).toMatchObject({
      approvalStatus: 'pending',
      storeRequestStatus: 'not-requested',
      sellingPricePerPax: 20000,
      sellingQuantity: 150,
      estimatedRevenue: 3000000,
    });
    expect(menus[0].salesRejectionReason).toBeUndefined();
    expect(mail.notifyMenuProductionsReadyForApproval).toHaveBeenCalled();
  });
});
