import { AppRole } from '../auth/roles.constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { MenuProductionsController } from './menu-productions.controller';

describe('MenuProductionsController sales input actor', () => {
  const makeController = () => {
    const menuProductions = {
      updateBatchSalesDetails: jest.fn(),
      updateSalesDetails: jest.fn(),
      buildStoreRequestGroups: jest.fn(),
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

  it('allows executive read access without granting production mutations', () => {
    const storeRequestsHandler = Object.getOwnPropertyDescriptor(
      MenuProductionsController.prototype,
      'storeRequests',
    )?.value as object;
    const approveHandler = Object.getOwnPropertyDescriptor(
      MenuProductionsController.prototype,
      'approve',
    )?.value as object;
    const readRoles = Reflect.getMetadata(
      ROLES_KEY,
      storeRequestsHandler,
    ) as AppRole[];
    const approveRoles = Reflect.getMetadata(
      ROLES_KEY,
      approveHandler,
    ) as AppRole[];

    expect(readRoles).toContain(AppRole.Executive);
    expect(approveRoles).not.toContain(AppRole.Executive);
  });

  it('lets an executive query an assigned site only', async () => {
    const { controller, menuProductions } = makeController();
    const executiveRequest = {
      user: {
        sub: 'executive-1',
        roles: [AppRole.Executive],
        site: 'SITE-001',
        sites: ['SITE-001', 'SITE-002'],
      },
    };

    await controller.storeRequests(executiveRequest as never, {
      site: 'SITE-002',
    });

    expect(menuProductions.buildStoreRequestGroups).toHaveBeenCalledWith(
      { site: 'SITE-002' },
      'SITE-002',
      undefined,
      false,
    );
    expect(() =>
      controller.storeRequests(executiveRequest as never, {
        site: 'SITE-999',
      }),
    ).toThrow('The selected site is not assigned to this Executive.');
  });
});
