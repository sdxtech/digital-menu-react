import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppRole } from '../auth/roles.constants';
import { RecipesController } from './recipes.controller';

describe('RecipesController corporate chef creation', () => {
  const makeController = () => {
    const recipes = { create: jest.fn().mockResolvedValue({ id: 'recipe-1' }) };
    return {
      controller: new RecipesController(recipes as never),
      recipes,
    };
  };

  const request = {
    user: {
      sub: 'corporate-chef-1',
      name: 'Corporate Chef',
      email: 'corporate@example.com',
      roles: [AppRole.CorporateChef],
      site: 'SITE-001',
      sites: ['SITE-001', 'SITE-002'],
    },
  };

  it('uses the selected assigned site as the recipe scope', async () => {
    const { controller, recipes } = makeController();
    const dto = {
      site: 'SITE-002',
      name: 'Corporate Recipe',
      category: 'Main Course',
    };

    await controller.create(request as never, dto);

    expect(recipes.create).toHaveBeenCalledWith(
      dto,
      expect.objectContaining({
        roles: [AppRole.CorporateChef],
        site: 'SITE-002',
        sites: ['SITE-001', 'SITE-002'],
      }),
    );
  });

  it('requires a site for corporate chef recipe creation', () => {
    const { controller } = makeController();

    expect(() =>
      controller.create(request as never, {
        name: 'Corporate Recipe',
        category: 'Main Course',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a site outside the corporate chef assignments', () => {
    const { controller } = makeController();

    expect(() =>
      controller.create(request as never, {
        site: 'OTHER-SITE',
        name: 'Corporate Recipe',
        category: 'Main Course',
      }),
    ).toThrow(ForbiddenException);
  });
});
