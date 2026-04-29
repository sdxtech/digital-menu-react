export enum AppRole {
  Superadmin = 'superadmin',
  Chef = 'chef',
  UnitManager = 'unit-manager',
  Storekeeper = 'storekeeper',
}

export const ALL_APP_ROLES: AppRole[] = [
  AppRole.Superadmin,
  AppRole.Chef,
  AppRole.UnitManager,
  AppRole.Storekeeper,
];
