import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { DashboardAccessController } from './dashboard-access.controller';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';

describe('Dashboard permission management authorization', () => {
  const guard = new RolesGuard(new Reflector());
  it.each(['settings', 'save'] as const)(
    'restricts %s to superadmin even for users granted full dashboard visibility',
    (method) => {
      for (const role of Object.values(AppRole)) {
        const context = new ExecutionContextHost(
          [{ user: { roles: [role] } }],
          DashboardAccessController,
          Object.getOwnPropertyDescriptor(
            DashboardAccessController.prototype,
            method,
          )?.value as () => unknown,
        );
        expect(guard.canActivate(context)).toBe(role === AppRole.Superadmin);
      }
    },
  );
});
