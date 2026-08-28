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

  it('only updates pending items when submitting batch sales details', async () => {
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

    expect(
      workflowMail.notifyMenuProductionsReadyForApproval,
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'menu-1',
        productionCode: 'MPR0038',
        site: 'S001',
        unitManagerId: '507f1f77bcf86cd799439011',
      }),
    ]);
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
});
