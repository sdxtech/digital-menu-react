import { ForbiddenException } from '@nestjs/common';
import { AppRole } from './roles.constants';
import type { JwtPayload } from './types/jwt-payload.type';

export const canAccessAllSites = (user: Pick<JwtPayload, 'roles'>) =>
  user.roles?.includes(AppRole.Superadmin) ?? false;

export const getUserSiteScope = (user: JwtPayload): string | undefined => {
  if (canAccessAllSites(user)) return undefined;

  const site = user.site?.trim();
  if (!site) {
    throw new ForbiddenException('User site is required for this resource.');
  }

  return site;
};
