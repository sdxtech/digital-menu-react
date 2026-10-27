import { AppRole } from '../auth/roles.constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { MenuProductionsController } from './menu-productions.controller';
import { validate } from 'class-validator';
import { DeleteMenuProductionBatchDto } from './dto/delete-menu-production-batch.dto';

describe('MenuProductionsController sales input actor', () => {
  const makeController = () => {
    const menuProductions = {
      updateBatchSalesDetails: jest.fn(),
      updateSalesDetails: jest.fn(),
      buildStoreRequestGroups: jest.fn(),
      deleteBatch: jest.fn(),
      findDrafts: jest.fn(),
      deleteDraft: jest.fn(),
      editSalesBatch: jest.fn(),
      rejectSalesBatch: jest.fn(),
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

  it('restricts MPR deletion to superadmin and forwards the exact reviewed selection', async () => {
    const { controller, menuProductions } = makeController();
    const dto = {
      menuProductionIds: ['507f1f77bcf86cd799439011'],
      reason: 'Duplicate MPR replaced by MPR0002',
    };
    const handler = Object.getOwnPropertyDescriptor(
      MenuProductionsController.prototype,
      'deleteBatch',
    )?.value as object;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      AppRole.Superadmin,
    ]);
    await controller.deleteBatch(
      { user: { ...request.user, roles: [AppRole.Superadmin] } } as never,
      dto,
    );
    expect(menuProductions.deleteBatch).toHaveBeenCalledWith(dto, undefined);
  });

  it.each([AppRole.Chef, AppRole.Superadmin])(
    'scopes draft listing and deletion for %s',
    async (role) => {
      const { controller, menuProductions } = makeController();
      const req = { user: { ...request.user, sub: 'actor-1', roles: [role] } };
      const allChefs = role === AppRole.Superadmin;
      const site = allChefs ? undefined : request.user.site;
      await controller.drafts(req as never);
      expect(menuProductions.findDrafts).toHaveBeenCalledWith(
        'actor-1',
        site,
        allChefs,
      );
      await controller.deleteDraft(req as never, 'MPR0001');
      expect(menuProductions.deleteDraft).toHaveBeenCalledWith(
        'MPR0001',
        'actor-1',
        site,
        allChefs,
      );
      for (const name of ['drafts', 'deleteDraft']) {
        const handler = Object.getOwnPropertyDescriptor(
          MenuProductionsController.prototype,
          name,
        )?.value as object;
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
          AppRole.Chef,
          AppRole.Superadmin,
        ]);
      }
    },
  );

  it('validates deletion ids and the required audit reason', async () => {
    const valid = {
      menuProductionIds: ['507f1f77bcf86cd799439011'],
      reason: 'Duplicate MPR',
    };
    await expect(
      validate(Object.assign(new DeleteMenuProductionBatchDto(), valid)),
    ).resolves.toEqual([]);
    for (const input of [
      { ...valid, menuProductionIds: [] },
      { ...valid, menuProductionIds: ['invalid-id'] },
      { ...valid, reason: '' },
      { ...valid, reason: 'x'.repeat(1001) },
    ]) {
      expect(
        (
          await validate(
            Object.assign(new DeleteMenuProductionBatchDto(), input),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it('allows only superadmin to edit sales and limits Reject Sales to superadmin or Unit Manager', async () => {
    const handler = (name: 'editSales' | 'rejectSales') =>
      Object.getOwnPropertyDescriptor(MenuProductionsController.prototype, name)
        ?.value as object;
    expect(Reflect.getMetadata(ROLES_KEY, handler('editSales'))).toEqual([
      AppRole.Superadmin,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, handler('rejectSales'))).toEqual([
      AppRole.Superadmin,
      AppRole.UnitManager,
    ]);
    const { controller, menuProductions } = makeController();
    const manager = {
      user: {
        ...request.user,
        sub: '507f1f77bcf86cd799439011',
        roles: [AppRole.UnitManager],
      },
    };
    const dto = {
      menuProductionIds: ['507f1f77bcf86cd799439012'],
      reason: 'Pax must be 150',
    };
    await controller.rejectSales(manager as never, dto);
    expect(menuProductions.rejectSalesBatch).toHaveBeenCalledWith(
      dto,
      'SITE-001',
      { id: manager.user.sub, name: 'Admin Site One' },
      manager.user.sub,
    );
  });

  it('exposes missing or rejected sales to the superadmin Sales Input inbox without bypassing UM readiness', async () => {
    const { controller, menuProductions } = makeController();
    const query = { approvalStatus: 'pending' as const, salesInput: true };
    await controller.storeRequests(
      { user: { ...request.user, roles: [AppRole.Superadmin] } } as never,
      query,
    );
    expect(menuProductions.buildStoreRequestGroups).toHaveBeenLastCalledWith(
      query,
      undefined,
      undefined,
      false,
    );
    await controller.storeRequests(
      { user: { ...request.user, roles: [AppRole.UnitManager] } } as never,
      query,
    );
    expect(menuProductions.buildStoreRequestGroups).toHaveBeenLastCalledWith(
      query,
      'SITE-001',
      request.user.sub,
      true,
    );
  });

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
