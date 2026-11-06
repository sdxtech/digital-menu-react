import { ForbiddenException } from '@nestjs/common';
import { AppRole } from '../auth/roles.constants';
import { resolveRecipeReadSite } from './recipe-read-scope';

describe('Finance Controller recipe read scope', () => {
  const user = {
    roles: [AppRole.FinanceController],
    site: 'SITE-A',
    sites: ['SITE-B', 'SITE-C'],
  } as never;

  it('allows a site assigned through Finance Controller settings', () => {
    expect(resolveRecipeReadSite(user, 'site-b')).toBe('SITE-B');
  });

  it('rejects an old primary site that is no longer assigned', () => {
    expect(() => resolveRecipeReadSite(user, 'SITE-A')).toThrow(
      ForbiddenException,
    );
  });
});
