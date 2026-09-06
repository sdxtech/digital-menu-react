import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppRole } from '../auth/roles.constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RecipesController } from './recipes.controller';

describe('RecipesController corporate chef creation', () => {
  const makeController = () => {
    const recipes = {
      create: jest.fn().mockResolvedValue({ id: 'recipe-1' }),
      findAll: jest.fn(),
    };
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

  it('allows executive recipe reads without granting recipe mutations', () => {
    const listHandler = Object.getOwnPropertyDescriptor(
      RecipesController.prototype,
      'list',
    )?.value as object;
    const approveHandler = Object.getOwnPropertyDescriptor(
      RecipesController.prototype,
      'approve',
    )?.value as object;
    const readRoles = Reflect.getMetadata(ROLES_KEY, listHandler) as AppRole[];
    const approveRoles = Reflect.getMetadata(
      ROLES_KEY,
      approveHandler,
    ) as AppRole[];

    expect(readRoles).toContain(AppRole.Executive);
    expect(approveRoles).not.toContain(AppRole.Executive);
  });

  it('lets an executive query recipes from an assigned site only', async () => {
    const { controller, recipes } = makeController();
    const executiveRequest = {
      user: {
        sub: 'executive-1',
        roles: [AppRole.Executive],
        site: 'SITE-001',
        sites: ['SITE-001', 'SITE-002'],
      },
    };

    await controller.list(executiveRequest as never, { site: 'SITE-002' });

    expect(recipes.findAll).toHaveBeenCalledWith(
      { site: 'SITE-002' },
      'SITE-002',
    );
    expect(() =>
      controller.list(executiveRequest as never, { site: 'SITE-999' }),
    ).toThrow('The selected site is not assigned to this Executive.');
  });
});
