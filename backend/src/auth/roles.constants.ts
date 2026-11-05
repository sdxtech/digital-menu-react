export enum AppRole {
  Superadmin = 'superadmin',
  Chef = 'chef',
  CorporateChef = 'corporate-chef',
  UnitManager = 'unit-manager',
  FinanceController = 'finance-controller',
  Executive = 'executive',
  AdminSite = 'admin-site',
  Storekeeper = 'storekeeper',
}

export const ALL_APP_ROLES: AppRole[] = [
  AppRole.Superadmin,
  AppRole.Chef,
  AppRole.CorporateChef,
  AppRole.UnitManager,
  AppRole.FinanceController,
  AppRole.Executive,
  AppRole.AdminSite,
  AppRole.Storekeeper,
];
