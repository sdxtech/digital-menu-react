import { AppRole } from '../auth/roles.constants';
import {
  DASHBOARD_COMPONENTS,
  emptyDashboardPolicy,
  resolveDashboardAccess,
} from './dashboard-access.policy';
import type { DashboardPolicy } from './dashboard-access.policy';

const policy = (overrides: Partial<DashboardPolicy> = {}): DashboardPolicy => ({
  ...emptyDashboardPolicy(),
  ...overrides,
});
describe('Dashboard access resolution', () => {
  it('denies unconfigured accounts and always preserves superadmin access', () => {
    expect(
      resolveDashboardAccess([AppRole.Chef], ['A'], [], policy()).dashboard,
    ).toBe(false);
    const admin = resolveDashboardAccess(
      [AppRole.Superadmin],
      [],
      [],
      policy({ dashboard: 'deny' }),
    );
    expect(admin.dashboard).toBe(true);
    expect(admin.sites).toBeNull();
    expect(Object.values(admin.components)).toEqual(
      DASHBOARD_COMPONENTS.map(() => true),
    );
  });

  it('drops blank inherited site codes instead of treating them as an unrestricted query', () => {
    const result = resolveDashboardAccess(
      [AppRole.Chef],
      [' ', ' A '],
      [policy({ dashboard: 'allow' })],
      policy(),
    );
    expect(result.sites).toEqual(['A']);
  });

  it('inherits grants and assigned sites, while user decisions override role decisions', () => {
    const role = policy({
      dashboard: 'allow',
      components: [
        { key: 'paxCard', decision: 'allow' },
        { key: 'costCard', decision: 'allow' },
      ],
    });
    const user = policy({
      components: [
        { key: 'costCard', decision: 'deny' },
        { key: 'revenueCard', decision: 'allow' },
      ],
      siteMode: 'selected',
      sites: ['B', 'C'],
    });
    const effective = resolveDashboardAccess(
      [AppRole.UnitManager],
      ['A'],
      [role],
      user,
    );
    expect(effective.sites).toEqual(['B', 'C']);
    expect(effective.components).toMatchObject({
      paxCard: true,
      costCard: false,
      revenueCard: true,
      paxChart: false,
    });
    expect(
      resolveDashboardAccess([AppRole.UnitManager], ['A'], [role], policy())
        .sites,
    ).toEqual(['A']);
    const denied = resolveDashboardAccess(
      [AppRole.UnitManager],
      ['A'],
      [role],
      policy({ dashboard: 'deny' }),
    );
    expect(denied.sites).toEqual([]);
    expect(Object.values(denied.components).some(Boolean)).toBe(false);
  });

  it('combines enabled roles, supports all sites, and does not inherit disabled-role grants', () => {
    const roles = [
      policy({ dashboard: 'allow', siteMode: 'selected', sites: ['A'] }),
      policy({ dashboard: 'allow', siteMode: 'selected', sites: ['B'] }),
    ];
    expect(
      resolveDashboardAccess([AppRole.Chef], [], roles, policy()).sites,
    ).toEqual(['A', 'B']);
    expect(
      resolveDashboardAccess(
        [AppRole.Chef],
        [],
        roles,
        policy({ siteMode: 'all' }),
      ).sites,
    ).toBeNull();
    const disabled = policy({
      dashboard: 'deny',
      siteMode: 'all',
      components: [{ key: 'costCard', decision: 'allow' }],
    });
    const user = resolveDashboardAccess(
      [AppRole.Chef],
      ['A'],
      [disabled],
      policy({ dashboard: 'allow' }),
    );
    expect(user.sites).toEqual(['A']);
    expect(user.components.costCard).toBe(false);
  });
});
