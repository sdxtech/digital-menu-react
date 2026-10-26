import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppRole } from '../auth/roles.constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RecipesController } from './recipes.controller';
import { validate } from 'class-validator';
import { RecheckRecipeDraftsDto } from './dto/recheck-recipe-drafts.dto';

describe('RecipesController corporate chef creation', () => {
  const makeController = () => {
    const recipes = {
      create: jest.fn().mockResolvedValue({ id: 'recipe-1' }),
      findAll: jest.fn(),
      findDrafts: jest.fn(),
      findDraftById: jest.fn(),
      recheckDrafts: jest.fn(),
      listSites: jest.fn(),
      deleteDraft: jest.fn().mockResolvedValue({ id: 'draft-1' }),
      importFromExcel: jest
        .fn()
        .mockResolvedValue({ insertedCount: 1, draftsCount: 1 }),
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

  it('passes pagination and actor scope to draft list and detail endpoints', async () => {
    const { controller, recipes } = makeController();
    const query = { page: 2, limit: 20, issueStatus: 'issues' as const };
    const draftId = '507f1f77bcf86cd799439011';
    await controller.listDrafts(request as never, query);
    await controller.getDraft(request as never, draftId);
    expect(recipes.findDrafts).toHaveBeenCalledWith(
      expect.objectContaining({
        id: request.user.sub,
        site: request.user.site,
        roles: [AppRole.CorporateChef],
      }),
      query,
    );
    expect(recipes.findDraftById).toHaveBeenCalledWith(
      draftId,
      expect.objectContaining({ id: request.user.sub }),
    );
    for (const name of ['listDrafts', 'getDraft']) {
      const handler = Object.getOwnPropertyDescriptor(
        RecipesController.prototype,
        name,
      )?.value as object;
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        AppRole.Chef,
        AppRole.CorporateChef,
        AppRole.Superadmin,
      ]);
    }
  });

  it('restricts bulk draft rechecks to Superadmin and passes the validated cursor', async () => {
    const { controller, recipes } = makeController();
    const adminRequest = {
      user: { ...request.user, sub: 'admin-1', roles: [AppRole.Superadmin] },
    };
    const dto = new RecheckRecipeDraftsDto();
    expect(await validate(dto)).toEqual([]);
    dto.afterId = 'invalid';
    expect(await validate(dto)).toHaveLength(1);
    dto.afterId = '507f1f77bcf86cd799439011';
    expect(await validate(dto)).toEqual([]);
    await controller.recheckDrafts(adminRequest as never, dto);
    expect(recipes.recheckDrafts).toHaveBeenCalledWith(
      expect.objectContaining({
        id: adminRequest.user.sub,
        roles: [AppRole.Superadmin],
        site: undefined,
      }),
      dto,
    );
    const handler = Object.getOwnPropertyDescriptor(
      RecipesController.prototype,
      'recheckDrafts',
    )?.value as object;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      AppRole.Superadmin,
    ]);
  });

  it('allows draft deletion for recipe authors without broadening general recipe deletion', async () => {
    const { controller, recipes } = makeController();
    const draftHandler = Object.getOwnPropertyDescriptor(
      RecipesController.prototype,
      'removeDraft',
    )?.value as object;
    const recipeHandler = Object.getOwnPropertyDescriptor(
      RecipesController.prototype,
      'remove',
    )?.value as object;
    expect(Reflect.getMetadata(ROLES_KEY, draftHandler)).toEqual([
      AppRole.Chef,
      AppRole.CorporateChef,
      AppRole.Superadmin,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, recipeHandler)).toEqual([
      AppRole.Superadmin,
    ]);
    await controller.removeDraft(request as never, 'draft-1');
    expect(recipes.deleteDraft).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        id: request.user.sub,
        site: request.user.site,
        roles: [AppRole.CorporateChef],
      }),
    );
  });

  it('allows corporate chefs to call the import endpoint', () => {
    const handler = Object.getOwnPropertyDescriptor(
      RecipesController.prototype,
      'importRecipes',
    )?.value as object;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      AppRole.Chef,
      AppRole.CorporateChef,
      AppRole.Superadmin,
    ]);
  });

  it('imports corporate chef recipes only into the selected assigned site', async () => {
    const { controller, recipes } = makeController();
    await controller.importRecipes(
      request as never,
      { path: 'recipes.xlsx' },
      'SITE-002',
    );
    expect(recipes.importFromExcel).toHaveBeenCalledWith(
      'recipes.xlsx',
      expect.objectContaining({ id: 'corporate-chef-1', site: 'SITE-002' }),
    );
    await expect(
      controller.importRecipes(request as never, { path: 'recipes.xlsx' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller.importRecipes(
        request as never,
        { path: 'recipes.xlsx' },
        'OTHER-SITE',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(recipes.importFromExcel).toHaveBeenCalledTimes(1);
  });

  it('keeps corporate-site imports at the owner site instead of approval sites', async () => {
    const { controller, recipes } = makeController();
    const corporateRequest = {
      user: {
        ...request.user,
        corporateSite: true,
        approvalSites: ['SITE-002'],
      },
    };
    await controller.importRecipes(corporateRequest as never, {
      path: 'recipes.xlsx',
    });
    expect(recipes.importFromExcel).toHaveBeenCalledWith(
      'recipes.xlsx',
      expect.objectContaining({ site: 'SITE-001', corporateSite: true }),
    );
    await expect(
      controller.importRecipes(
        corporateRequest as never,
        { path: 'recipes.xlsx' },
        'SITE-002',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(recipes.importFromExcel).toHaveBeenCalledTimes(1);
  });

  it('scopes recipe site options to the current user visibility', async () => {
    const { controller, recipes } = makeController();
    await controller.listSites(request as never);
    expect(recipes.listSites).toHaveBeenCalledWith('SITE-001', false);
  });

  it('allows superadmins to see site options for disabled recipes', async () => {
    const { controller, recipes } = makeController();
    await controller.listSites({
      user: { ...request.user, roles: [AppRole.Superadmin] },
    } as never);
    expect(recipes.listSites).toHaveBeenCalledWith(undefined, true);
  });

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
