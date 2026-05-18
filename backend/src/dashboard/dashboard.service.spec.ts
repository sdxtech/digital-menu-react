import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const makeModel = () => ({
    countDocuments: jest.fn().mockResolvedValue(0),
  });

  it('excludes soft-deleted pending recipes from the superadmin summary', async () => {
    const menuProductionModel = makeModel();
    const userModel = makeModel();
    const siteModel = makeModel();
    const recipeModel = makeModel();

    const service = new DashboardService(
      menuProductionModel as never,
      userModel as never,
      siteModel as never,
      recipeModel as never,
    );

    await service.getSuperadminSummary();

    expect(recipeModel.countDocuments).toHaveBeenCalledWith({
      approvalStatus: 'pending',
      deletedAt: { $exists: false },
    });
  });
});
