import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { InventoryController } from './inventory.controller';
import { InventoryQueryDto } from './inventory.dto';
import type { InventoryService } from './inventory.service';

describe('Inventory authorization', () => {
  const request = (role: AppRole, site?: string) =>
    ({
      user: {
        sub: 'user',
        name: 'User',
        email: 'user@example.test',
        roles: [role],
        site,
      },
    }) as AuthenticatedRequest;

  it('forces storekeepers to their own site even when another site is requested', async () => {
    const inventory = {
      resolveSite: jest.fn((site: string) => Promise.resolve(site)),
      status: jest.fn(),
    };
    const controller = new InventoryController(
      inventory as unknown as InventoryService,
    );
    await controller.status(request(AppRole.Storekeeper, 'S001'), {
      ...new InventoryQueryDto(),
      site: 'S002',
    });
    expect(inventory.resolveSite).toHaveBeenCalledWith('S001');
    expect(inventory.status).toHaveBeenCalledWith('S001');
  });

  it('requires a site assignment for storekeepers', async () => {
    const controller = new InventoryController({} as InventoryService);
    await expect(
      controller.status(request(AppRole.Storekeeper), new InventoryQueryDto()),
    ).rejects.toThrow('User site is required');
  });

  it('allows superadmin site selection and restricts reversal to superadmin', async () => {
    const inventory = {
      resolveSite: jest.fn((site: string) => Promise.resolve(site)),
      status: jest.fn(),
    };
    const controller = new InventoryController(
      inventory as unknown as InventoryService,
    );
    await controller.status(request(AppRole.Superadmin), {
      ...new InventoryQueryDto(),
      site: 'S002',
    });
    expect(inventory.resolveSite).toHaveBeenCalledWith('S002');
    const guard = new RolesGuard(new Reflector());
    const context = (role: AppRole, handler: string) =>
      ({
        getHandler: () =>
          Object.getOwnPropertyDescriptor(
            InventoryController.prototype,
            handler,
          )?.value as unknown,
        getClass: () => InventoryController,
        switchToHttp: () => ({ getRequest: () => request(role, 'S001') }),
      }) as ExecutionContext;
    expect(
      guard.canActivate(context(AppRole.Storekeeper, 'reverseReceipt')),
    ).toBe(false);
    expect(
      guard.canActivate(context(AppRole.Superadmin, 'reverseReceipt')),
    ).toBe(true);
    expect(guard.canActivate(context(AppRole.Storekeeper, 'editReceipt'))).toBe(
      false,
    );
    expect(guard.canActivate(context(AppRole.Superadmin, 'editReceipt'))).toBe(
      true,
    );
    expect(guard.canActivate(context(AppRole.Chef, 'createReceipt'))).toBe(
      false,
    );
    expect(
      guard.canActivate(context(AppRole.Storekeeper, 'createReceipt')),
    ).toBe(true);
  });
});
