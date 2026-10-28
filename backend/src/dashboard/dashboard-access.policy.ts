import { AppRole } from '../auth/roles.constants';

export const DASHBOARD_COMPONENTS = [
  'foodCostCard',
  'paxCard',
  'costCard',
  'revenueCard',
  'approvalStatus',
  'storeRequestStatus',
  'foodCostChart',
  'paxChart',
  'financialChart',
] as const;
export type DashboardComponent = (typeof DASHBOARD_COMPONENTS)[number];
export type AccessDecision = 'inherit' | 'allow' | 'deny';
export type DashboardPolicy = {
  dashboard: AccessDecision;
  components: { key: DashboardComponent; decision: AccessDecision }[];
  siteMode: 'inherit' | 'all' | 'selected';
  sites: string[];
};
export type EffectiveDashboardAccess = {
  dashboard: boolean;
  components: Record<DashboardComponent, boolean>;
  sites: string[] | null;
};

export const emptyDashboardPolicy = (): DashboardPolicy => ({
  dashboard: 'inherit',
  components: [],
  siteMode: 'inherit',
  sites: [],
});

export function resolveDashboardAccess(
  roles: AppRole[],
  assignedSites: string[],
  rolePolicies: DashboardPolicy[],
  userPolicy: DashboardPolicy,
): EffectiveDashboardAccess {
  if (roles.includes(AppRole.Superadmin)) {
    return {
      dashboard: true,
      sites: null,
      components: Object.fromEntries(
        DASHBOARD_COMPONENTS.map((key) => [key, true]),
      ) as Record<DashboardComponent, boolean>,
    };
  }
  const enabledRoles = rolePolicies.filter(
    (policy) => policy.dashboard === 'allow',
  );
  const dashboard =
    userPolicy.dashboard === 'inherit'
      ? enabledRoles.length > 0
      : userPolicy.dashboard === 'allow';
  const components = Object.fromEntries(
    DASHBOARD_COMPONENTS.map((key) => {
      const override =
        userPolicy.components.find((rule) => rule.key === key)?.decision ??
        'inherit';
      const inherited = enabledRoles.some((policy) =>
        policy.components.some(
          (rule) => rule.key === key && rule.decision === 'allow',
        ),
      );
      return [
        key,
        dashboard &&
          (override === 'inherit' ? inherited : override === 'allow'),
      ];
    }),
  ) as Record<DashboardComponent, boolean>;
  if (!dashboard) return { dashboard, components, sites: [] };
  const policies =
    userPolicy.siteMode === 'inherit' ? enabledRoles : [userPolicy];
  const sites = policies.some((policy) => policy.siteMode === 'all')
    ? null
    : [
        ...new Set(
          (policies.length
            ? policies.flatMap((policy) =>
                policy.siteMode === 'selected' ? policy.sites : assignedSites,
              )
            : assignedSites
          )
            .map((site) => site.trim())
            .filter(Boolean),
        ),
      ];
  return { dashboard, components, sites };
}
