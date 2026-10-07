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

  it('restricts conversion sync to superadmin', () => {
    const handler = Object.getOwnPropertyDescriptor(
      RecipesController.prototype,
      'syncIngredientConversions',
    )?.value as object;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      AppRole.Superadmin,
    ]);
  });

  it('allows only superadmin to change the target food cost requirement', () => {
    const handler = Object.getOwnPropertyDescriptor(
      RecipesController.prototype,
      'updateSettings',
    )?.value as object;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      AppRole.Superadmin,
    ]);
  });

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

  it('automatically owns new recipes at the corporate assignment', async () => {
    const { controller, recipes } = makeController();
    const corporateRequest = {
      user: {
        ...request.user,
        corporateSite: true,
        approvalSites: ['SITE-002'],
      },
    };
    const dto = { name: 'Corporate Recipe', category: 'Main Course' };
    await controller.create(corporateRequest as never, dto);
    expect(recipes.create).toHaveBeenCalledWith(
      dto,
      expect.objectContaining({ site: 'SITE-001', corporateSite: true }),
    );
    expect(() =>
      controller.create(corporateRequest as never, {
        ...dto,
        site: 'SITE-002',
      }),
    ).toThrow(ForbiddenException);
  });

  it('includes corporate sites in all-site approvals and rejects unrelated sites', async () => {
    const { controller, recipes } = makeController();
    const corporateRequest = {
      user: {
        ...request.user,
        corporateSite: true,
        approvalSites: ['SITE-001', 'SITE-002', 'CORP-OTHER'],
      },
    };
    await controller.list(corporateRequest as never, {
      approvalStatus: 'pending',
    });
    expect(recipes.findAll).toHaveBeenCalledWith(
      { approvalStatus: 'pending' },
      ['SITE-001', 'SITE-002', 'CORP-OTHER'],
      false,
    );
    await controller.list(corporateRequest as never, { site: 'CORP-OTHER' });
    expect(recipes.findAll).toHaveBeenLastCalledWith(
      { site: 'CORP-OTHER' },
      'CORP-OTHER',
      false,
    );
    expect(() =>
      controller.list(corporateRequest as never, { site: 'SITE-999' }),
    ).toThrow(ForbiddenException);
  });

  it('filters corporate approvals to a selected set of authorized sites', async () => {
    const { controller, recipes } = makeController();
    const corporateRequest = {
      user: {
        ...request.user,
        corporateSite: true,
        approvalSites: ['SITE-001', 'SITE-002', 'CORP-OTHER'],
      },
    };
    const query = {
      sites: 'site-002, CORP-OTHER,SITE-002',
      strictSite: 'true' as const,
      approvalStatus: 'pending' as const,
    };
    await controller.list(corporateRequest as never, query);
    expect(recipes.findAll).toHaveBeenCalledWith(
      query,
      ['SITE-002', 'CORP-OTHER'],
      false,
    );
  });

  it('rejects the entire multi-site request if one site is unauthorized', () => {
    const { controller, recipes } = makeController();
    const corporateRequest = {
      user: {
        ...request.user,
        corporateSite: true,
        approvalSites: ['SITE-001', 'SITE-002'],
      },
    };
    expect(() =>
      controller.list(corporateRequest as never, {
        sites: 'SITE-002,SITE-999',
      }),
    ).toThrow(ForbiddenException);
    expect(recipes.findAll).not.toHaveBeenCalled();
  });

  it('keeps a corporate chef at an operational site within their assignments', async () => {
    const { controller, recipes } = makeController();
    await controller.list(request as never, { sites: 'SITE-001,SITE-002' });
    expect(recipes.findAll).toHaveBeenCalledWith(
      { sites: 'SITE-001,SITE-002' },
      ['SITE-001', 'SITE-002'],
      false,
    );
    expect(() =>
      controller.list(request as never, { sites: 'SITE-001,CORP-OTHER' }),
    ).toThrow(ForbiddenException);
  });

  it.each(['', ' ', 'SITE-002,', ',SITE-002'])(
    'rejects an empty or malformed multi-site filter: %j',
    (sites) => {
      const { controller, recipes } = makeController();
      expect(() => controller.list(request as never, { sites })).toThrow(
        BadRequestException,
      );
      expect(recipes.findAll).not.toHaveBeenCalled();
    },
  );

  it('rejects conflicting filters and prevents a Chef from accessing multiple sites', () => {
    const { controller } = makeController();
    expect(() =>
      controller.list(request as never, {
        site: 'SITE-001',
        sites: 'SITE-002',
      }),
    ).toThrow(BadRequestException);
    const chefRequest = { user: { ...request.user, roles: [AppRole.Chef] } };
    expect(() =>
      controller.list(chefRequest as never, { sites: 'SITE-001,SITE-002' }),
    ).toThrow(ForbiddenException);
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
      false,
    );
    expect(() =>
      controller.list(executiveRequest as never, { site: 'SITE-999' }),
    ).toThrow('The selected site is not assigned to this Executive.');
  });

  it('hides disabled recipes from non-superadmin recipe data', async () => {
    const { controller, recipes } = makeController();

    await controller.list(request as never, {});

    expect(recipes.findAll).toHaveBeenCalledWith({}, 'SITE-001', false);
  });

  it('keeps disabled recipes available to superadmin', async () => {
    const { controller, recipes } = makeController();
    const superadminRequest = {
      user: {
        sub: 'superadmin-1',
        roles: [AppRole.Superadmin],
      },
    };

    await controller.list(superadminRequest as never, {});

    expect(recipes.findAll).toHaveBeenCalledWith({}, undefined, true);
  });
});
