export enum AppRole {
  Superadmin = 'superadmin',
  Chef = 'chef',
  UnitManager = 'unit-manager',
  Storekeeper = 'storekeeper',
}

export const DEFAULT_ROLE = AppRole.Chef;
