import { ForbiddenException } from '@nestjs/common';
import { AppRole } from '../auth/roles.constants';
import { getUserSiteScope } from '../auth/site-scope';
import type { JwtPayload } from '../auth/types/jwt-payload.type';

export const resolveRecipeReadSite = (
  user: JwtPayload,
  requestedSite?: string,
): string | string[] | undefined => {
  if (user.roles?.includes(AppRole.CorporateChef) && user.corporateSite) {
    const allowed = [user.site, ...(user.approvalSites ?? [])].filter(
      (site): site is string => Boolean(site),
    );
    const requested = requestedSite?.trim();
    if (!requested) return user.approvalSites ?? [];
    const matched = allowed.find(
      (site) => site.toLowerCase() === requested.toLowerCase(),
    );
    if (!matched)
      throw new ForbiddenException(
        'The selected site is outside your recipe scope.',
      );
    return matched;
  }
  if (user.roles?.includes(AppRole.Executive)) {
    const assignedSites = Array.from(
      new Set([user.site, ...(user.sites ?? [])]),
    )
      .map((site) => site?.trim())
      .filter((site): site is string => Boolean(site));
    const requested = requestedSite?.trim();
    if (!requested) return user.site?.trim() || assignedSites[0];
    const assignedSite = assignedSites.find(
      (site) => site.toLowerCase() === requested.toLowerCase(),
    );
    if (!assignedSite)
      throw new ForbiddenException(
        'The selected site is not assigned to this Executive.',
      );
    return assignedSite;
  }
  if (user.roles?.includes(AppRole.CorporateChef)) {
    const assignedSites = (user.sites ?? []).map((site) =>
      site.trim().toLowerCase(),
    );
    const requested = requestedSite?.trim();
    if (requested && assignedSites.includes(requested.toLowerCase()))
      return requested;
    return user.site?.trim() || undefined;
  }
  return getUserSiteScope(user) || requestedSite?.trim() || undefined;
};
