import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { AppRole } from '../auth/roles.constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ExportsController } from './exports.controller';
import { ExportRecipesDto } from './dto/export-recipes.dto';
import { ExportsService } from './exports.service';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';

const setup = () => {
  const job = {
    id: '42',
    name: 'export-recipes',
    data: { userId: 'owner', total: 2 },
    progress: 1,
    failedReason: '',
    returnvalue: {
      key: 'exports/recipes.xlsx',
      filename: 'recipes.xlsx',
      count: 2,
    },
    getState: jest.fn().mockResolvedValue('active'),
  };
  const queue = {
    add: jest.fn().mockResolvedValue(job),
    getJob: jest.fn().mockResolvedValue(job),
  };
  const recipes = {
    count: jest.fn().mockResolvedValue(2),
    downloadFile: jest.fn().mockResolvedValue('local file stream'),
  };
  return {
    service: new ExportsService(queue as never, recipes as never),
    queue,
    recipes,
    job,
  };
};

describe('Recipe exports', () => {
  it.each(['exportRecipes', 'recipeStatus', 'recipeDownload', 'recipeCount'])(
    'allows %s only for roles with Recipe Data',
    (method) => {
      const handler = Object.getOwnPropertyDescriptor(
        ExportsController.prototype,
        method,
      )?.value as object;
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        AppRole.Superadmin,
        AppRole.Chef,
        AppRole.UnitManager,
        AppRole.CorporateChef,
        AppRole.Executive,
      ]);
    },
  );

  it.each([
    [AppRole.Superadmin, undefined, true, false],
    [AppRole.Chef, 'site-a', false, false],
    [AppRole.UnitManager, 'site-a', false, false],
    [AppRole.CorporateChef, 'site-a', false, false],
    [AppRole.Executive, 'site-b', false, true],
  ])(
    'uses the same trusted scope for %s counts and jobs',
    async (role, site, includeInactive, strictSite) => {
      const context = setup();
      const controller = new ExportsController(context.service);
      const req = {
        user: {
          sub: 'owner',
          name: 'User',
          email: 'user@example.com',
          roles: [role],
          site: 'site-a',
          sites: ['site-a', 'site-b'],
        },
      } as AuthenticatedRequest;
      const input: ExportRecipesDto = { mode: 'all', site: 'site-b' };
      const scope = { site, includeInactive, strictSite };
      await controller.recipeCount(req, input);
      await controller.exportRecipes(req, input);
      expect(context.recipes.count).toHaveBeenCalledTimes(2);
      expect(context.recipes.count).toHaveBeenNthCalledWith(
        1,
        undefined,
        expect.any(String),
        undefined,
        scope,
      );
      expect(context.recipes.count).toHaveBeenNthCalledWith(
        2,
        undefined,
        expect.any(String),
        undefined,
        scope,
      );
      expect(context.queue.add).toHaveBeenCalledWith(
        'export-recipes',
        expect.objectContaining({ scope }),
        expect.any(Object),
      );
    },
  );

  it('uses corporate approval sites and rejects an unassigned executive site', async () => {
    const context = setup();
    const controller = new ExportsController(context.service);
    const req = {
      user: {
        sub: 'owner',
        name: 'User',
        email: 'user@example.com',
        roles: [AppRole.CorporateChef],
        site: 'corporate',
        corporateSite: true,
        approvalSites: ['site-a', 'site-b'],
      },
    } as AuthenticatedRequest;
    await controller.exportRecipes(req, { mode: 'all' });
    expect(context.queue.add).toHaveBeenCalledWith(
      'export-recipes',
      expect.objectContaining({
        scope: {
          site: ['site-a', 'site-b'],
          includeInactive: false,
          strictSite: false,
        },
      }),
      expect.any(Object),
    );
    req.user.roles = [AppRole.Executive];
    req.user.sites = ['site-a'];
    expect(() =>
      controller.exportRecipes(req, { mode: 'all', site: 'unassigned' }),
    ).toThrow(ForbiddenException);
    expect(() =>
      controller.recipeCount(req, { mode: 'all', site: 'unassigned' }),
    ).toThrow(ForbiddenException);
    expect(context.queue.add).toHaveBeenCalledTimes(1);
  });

  it('rejects selected IDs outside the trusted scope before queueing', async () => {
    const context = setup();
    context.recipes.count.mockResolvedValueOnce(1);
    const scope = { site: 'site-a', includeInactive: false, strictSite: false };
    const ids = ['000000000000000000000001', '000000000000000000000002'];
    await expect(
      context.service.enqueueRecipes('owner', { mode: 'selected', ids }, scope),
    ).rejects.toThrow('Some selected recipes');
    expect(context.recipes.count).toHaveBeenCalledWith(
      ids,
      expect.any(String),
      undefined,
      scope,
    );
    expect(context.queue.add).not.toHaveBeenCalled();
  });

  it('validates recipe IDs and selection limits at the request boundary', async () => {
    const dto = Object.assign(new ExportRecipesDto(), {
      mode: 'selected',
      ids: ['invalid'],
    });
    expect(await validate(dto)).not.toHaveLength(0);
    dto.ids = ['000000000000000000000001'];
    expect(await validate(dto)).toHaveLength(0);
    dto.ids = Array<string>(10001).fill('000000000000000000000001');
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('deduplicates selection and enqueues a background export with a cutoff and bounded retention', async () => {
    const { service, queue, recipes } = setup();
    const ids = ['000000000000000000000001', '000000000000000000000002'];
    await expect(
      service.enqueueRecipes('owner', {
        mode: 'selected',
        ids: [...ids, ids[0]],
      }),
    ).resolves.toEqual({ jobId: '42', total: 2 });
    expect(queue.add).toHaveBeenCalledWith(
      'export-recipes',
      expect.objectContaining({ userId: 'owner', ids, total: 2 }),
      expect.objectContaining({
        attempts: 1,
        removeOnComplete: { age: 86400, count: 100 },
      }),
    );
    expect(recipes.count).toHaveBeenCalledWith(
      ids,
      expect.any(String),
      undefined,
      undefined,
    );
  });

  it('exports all available recipes without passing IDs or pagination', async () => {
    const { service, queue, recipes } = setup();
    await service.enqueueRecipes('owner', { mode: 'all' });
    expect(recipes.count).toHaveBeenCalledWith(
      undefined,
      expect.any(String),
      undefined,
      undefined,
    );
    expect(queue.add).toHaveBeenCalledWith(
      'export-recipes',
      expect.objectContaining({ ids: undefined }),
      expect.any(Object),
    );
  });

  it('counts all selectable recipes without creating an export job', async () => {
    const { service, recipes, queue } = setup();
    await expect(service.recipeCount({ mode: 'all' })).resolves.toEqual({
      total: 2,
    });
    expect(recipes.count).toHaveBeenCalledWith(
      undefined,
      expect.any(String),
      undefined,
      undefined,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('counts select-all exclusions using the same scope as the export', async () => {
    const { service, recipes, queue } = setup();
    const excludedIds = ['000000000000000000000001'];
    await expect(
      service.recipeCount({
        mode: 'all',
        excludedIds: [...excludedIds, excludedIds[0]],
      }),
    ).resolves.toEqual({ total: 2 });
    expect(recipes.count).toHaveBeenCalledWith(
      undefined,
      expect.any(String),
      excludedIds,
      undefined,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('returns zero when no selectable recipes remain', async () => {
    const { service, recipes } = setup();
    recipes.count.mockResolvedValueOnce(0);
    await expect(service.recipeCount({ mode: 'all' })).resolves.toEqual({
      total: 0,
    });
  });

  it('rejects ambiguous requests to count selected recipes', async () => {
    const { service, recipes } = setup();
    await expect(
      service.recipeCount({
        mode: 'selected',
        ids: ['000000000000000000000001'],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.recipeCount({ mode: 'all', ids: ['000000000000000000000001'] }),
    ).rejects.toThrow(BadRequestException);
    expect(recipes.count).not.toHaveBeenCalled();
  });

  it('rejects empty, unavailable or ambiguous selections', async () => {
    const { service, recipes, queue } = setup();
    await expect(
      service.enqueueRecipes('owner', { mode: 'selected' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.enqueueRecipes('owner', {
        mode: 'all',
        ids: ['000000000000000000000001'],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.enqueueRecipes('owner', {
        mode: 'selected',
        ids: ['000000000000000000000001'],
        excludedIds: ['000000000000000000000002'],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.enqueueRecipes('owner', {
        mode: 'selected',
        ids: ['000000000000000000000001'],
      }),
    ).rejects.toThrow(BadRequestException);
    recipes.count.mockResolvedValueOnce(0);
    await expect(
      service.enqueueRecipes('owner', { mode: 'all' }),
    ).rejects.toThrow(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('excludes unchecked recipes from select-all without loading every recipe ID', async () => {
    const { service, recipes, queue } = setup();
    const excludedIds = ['000000000000000000000001'];
    await expect(
      service.enqueueRecipes('owner', {
        mode: 'all',
        excludedIds: [...excludedIds, excludedIds[0]],
      }),
    ).resolves.toEqual({ jobId: '42', total: 2 });
    expect(recipes.count).toHaveBeenCalledWith(
      undefined,
      expect.any(String),
      excludedIds,
      undefined,
    );
    expect(queue.add).toHaveBeenCalledWith(
      'export-recipes',
      expect.objectContaining({
        ids: undefined,
        excludedIds,
        total: 2,
      }),
      expect.any(Object),
    );
  });

  it('validates excluded recipe IDs and rejects selecting no remaining recipes', async () => {
    const dto = Object.assign(new ExportRecipesDto(), {
      mode: 'all',
      excludedIds: ['invalid'],
    });
    expect(await validate(dto)).not.toHaveLength(0);
    dto.excludedIds = ['000000000000000000000001'];
    expect(await validate(dto)).toHaveLength(0);
    dto.excludedIds = Array<string>(10001).fill('000000000000000000000001');
    expect(await validate(dto)).not.toHaveLength(0);
    const { service, recipes, queue } = setup();
    recipes.count.mockResolvedValueOnce(0);
    await expect(
      service.enqueueRecipes('owner', {
        mode: 'all',
        excludedIds: ['000000000000000000000001'],
      }),
    ).rejects.toThrow('No recipes are available');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('checks ownership and job type before exposing status or downloads', async () => {
    const { service, job, recipes } = setup();
    await expect(service.recipeStatus('someone-else', '42')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.recipeDownload('someone-else', '42')).rejects.toThrow(
      NotFoundException,
    );
    job.name = 'export-products';
    await expect(service.recipeStatus('owner', '42')).rejects.toThrow(
      NotFoundException,
    );
    expect(recipes.downloadFile).not.toHaveBeenCalled();
  });

  it('exposes progress and only opens the download after completion', async () => {
    const { service, job, recipes } = setup();
    await expect(service.recipeStatus('owner', '42')).resolves.toEqual({
      jobId: '42',
      status: 'processing',
      total: 2,
      completed: 1,
    });
    await expect(service.recipeDownload('owner', '42')).rejects.toThrow(
      ConflictException,
      ForbiddenException,
    );
    job.getState.mockResolvedValue('completed');
    await expect(service.recipeDownload('owner', '42')).resolves.toBe(
      'local file stream',
    );
    expect(recipes.downloadFile).toHaveBeenCalledWith(job.returnvalue);
  });
});
