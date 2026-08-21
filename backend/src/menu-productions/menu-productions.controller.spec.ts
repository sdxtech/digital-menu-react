import { AppRole } from '../auth/roles.constants';
import { MenuProductionsController } from './menu-productions.controller';

describe('MenuProductionsController sales input actor', () => {
  const makeController = () => {
    const menuProductions = {
      updateBatchSalesDetails: jest.fn(),
      updateSalesDetails: jest.fn(),
    };
    return {
      controller: new MenuProductionsController(menuProductions as never),
      menuProductions,
    };
  };

  const request = {
    user: {
      sub: 'admin-site-1',
      name: '  Admin Site One  ',
      email: 'admin@example.com',
      roles: [AppRole.AdminSite],
      site: 'SITE-001',
    },
  };

  it('records the admin name when batch sales details are submitted', async () => {
    const { controller, menuProductions } = makeController();
    const dto = {
      productionCode: 'MPR0001',
      sellingPricePerPax: 15000,
      sellingQuantity: 1000,
    };

    await controller.updateBatchSalesDetails(request as never, dto);

    expect(menuProductions.updateBatchSalesDetails).toHaveBeenCalledWith(
      'MPR0001',
      dto,
      'SITE-001',
      'Admin Site One',
    );
  });

  it('falls back to the admin email when the name is blank', async () => {
    const { controller, menuProductions } = makeController();
    const requestWithoutName = {
      ...request,
      user: { ...request.user, name: '   ' },
    };
    const dto = { sellingPricePerPax: 15000, sellingQuantity: 1000 };

    await controller.updateSalesDetails(
      requestWithoutName as never,
      'menu-production-1',
      dto,
    );

    expect(menuProductions.updateSalesDetails).toHaveBeenCalledWith(
      'menu-production-1',
      dto,
      'SITE-001',
      'admin@example.com',
    );
  });
});
