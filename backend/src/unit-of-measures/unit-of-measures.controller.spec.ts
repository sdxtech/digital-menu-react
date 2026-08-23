import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { UnitOfMeasuresController } from './unit-of-measures.controller';

describe('UnitOfMeasuresController read access', () => {
  it.each(['listUnits', 'listConversions'] as const)(
    'allows Corporate Chef to call %s',
    (methodName) => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        UnitOfMeasuresController.prototype[methodName],
      ) as AppRole[];

      expect(roles).toEqual(
        expect.arrayContaining([
          AppRole.Chef,
          AppRole.CorporateChef,
          AppRole.Superadmin,
        ]),
      );
    },
  );
});
