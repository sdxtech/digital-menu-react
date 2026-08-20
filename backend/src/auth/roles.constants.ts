export enum AppRole {
  Superadmin = 'superadmin',
  Chef = 'chef',
  CorporateChef = 'corporate-chef',
  UnitManager = 'unit-manager',
  AdminSite = 'admin-site',
  Storekeeper = 'storekeeper',
}

export const ALL_APP_ROLES: AppRole[] = [
  AppRole.Superadmin,
  AppRole.Chef,
  AppRole.CorporateChef,
  AppRole.UnitManager,
  AppRole.AdminSite,
  AppRole.Storekeeper,
];
