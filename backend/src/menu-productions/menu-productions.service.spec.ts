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
      { _id: 'menu-id', approvalStatus: 'pending' },
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
        { sellingPricePerPax: 15000, sellingQuantity: 100 },
        undefined,
        'Admin Site',
      ),
    ).rejects.toThrow(NotFoundException);

    expect(updateMany).toHaveBeenCalledWith(
      { productionCode: 'MPR0038', approvalStatus: 'pending' },
      expect.any(Object),
    );
  });
});
