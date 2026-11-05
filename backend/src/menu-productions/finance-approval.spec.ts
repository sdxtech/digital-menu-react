import { ConflictException } from '@nestjs/common';
import { MenuProductionsService } from './menu-productions.service';
import { productionBatchPagePipeline } from './production-batch-page';

const createService = (model: Record<string, jest.Mock>) =>
  new MenuProductionsService(
    model as never,
    {} as never,
    {} as never,
    {} as never,
    {
      createHierarchicalNotification: jest.fn().mockResolvedValue(undefined),
    } as never,
    {} as never,
    {} as never,
  );

describe('Finance Controller approval', () => {
  it('lists assigned batches only after Admin Site enters sales', () => {
    const pipeline = productionBatchPagePipeline(
      {},
      { view: 'finance-approval', page: 1, limit: 10 },
    );
    expect(pipeline).toContainEqual({
      $match: { $and: [{ financePending: 1, salesReady: 1 }] },
    });
  });

  it('holds the complete batch out of the Unit Manager queue while finance review is pending', () => {
    const pipeline = productionBatchPagePipeline(
      {},
      { view: 'approval', page: 1, limit: 10 },
    );
    expect(pipeline).toContainEqual({
      $match: { $and: [{ financeBlocked: 0, salesReady: 1 }] },
    });
  });

  it('keeps Unit Manager review blocked until both finance decisions are approved', async () => {
    const model = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            financeApprovalRequired: true,
            financeCostStatus: 'approved',
            financeSalesStatus: 'pending',
          }),
        }),
      }),
      findOneAndUpdate: jest.fn(),
    };
    const service = createService(model);

    await expect(
      service.setApprovalStatus(
        'menu-1',
        'rejected',
        'SITE-A',
        'Manager',
        '507f1f77bcf86cd799439011',
        'Review required',
      ),
    ).rejects.toThrow(ConflictException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('allows one assigned controller to return a menu cost to the Chef', async () => {
    const updated = {
      id: 'menu-1',
      financeCostStatus: 'rejected',
      approvalStatus: 'rejected',
    };
    const model = {
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue({ lean: jest.fn().mockResolvedValue(updated) }),
    };
    const service = createService(model);

    await expect(
      service.reviewFinanceCost(
        '507f1f77bcf86cd799439012',
        'rejected',
        'controller-2',
        'Controller B',
        'Cost too high',
      ),
    ).resolves.toEqual(updated);
    const [[filter, update, options]] = model.findOneAndUpdate.mock
      .calls as unknown as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
      { new: boolean },
    ][];
    expect(filter).toMatchObject({
      _id: '507f1f77bcf86cd799439012',
      financeControllerIds: 'controller-2',
      financeCostStatus: 'pending',
    });
    expect(filter).toMatchObject({
      sellingPricePerPax: { $type: 'number' },
      sellingQuantity: { $type: 'number' },
    });
    expect(update.$set).toMatchObject({
      financeCostStatus: 'rejected',
      approvalStatus: 'rejected',
      rejectionReason: 'Cost too high',
    });
    expect(options).toEqual({ new: true });
  });
});
