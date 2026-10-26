import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { DashboardController } from './dashboard.controller';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';

describe('Superadmin analytics access', () => {
  const guard = new RolesGuard(new Reflector());
  const context = (roles: AppRole[]) =>
    new ExecutionContextHost(
      [{ user: { roles } }],
      DashboardController,
      Object.getOwnPropertyDescriptor(
        DashboardController.prototype,
        'analytics',
      )?.value as () => unknown,
    );

  it('allows superadmin and rejects all other roles', () => {
    expect(guard.canActivate(context([AppRole.Superadmin]))).toBe(true);
    for (const role of Object.values(AppRole)) {
      if (role !== AppRole.Superadmin) {
        expect(guard.canActivate(context([role]))).toBe(false);
      }
    }
    expect(guard.canActivate(context([]))).toBe(false);
  });

  it('passes analytics filters to the service', async () => {
    const getSuperadminAnalytics = jest.fn();
    const controller = new DashboardController({
      getSuperadminAnalytics,
    } as never);
    const query = {
      startDate: '2026-10-01',
      endDate: '2026-10-13',
      site: 'S01',
    };
    await controller.analytics(query);
    expect(getSuperadminAnalytics).toHaveBeenCalledWith(query);
  });
});
