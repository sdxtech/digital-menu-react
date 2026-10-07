import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole, ALL_APP_ROLES } from '../auth/roles.constants';
import { getUserSiteScope } from '../auth/site-scope';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { getUploadDir } from '../common/upload-dir';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { ListRecipesQueryDto } from './dto/list-recipes.query.dto';
import { RejectRecipeDto } from './dto/reject-recipe.dto';
import { ResubmitRecipeDto } from './dto/resubmit-recipe.dto';
import { SetRecipeActiveDto } from './dto/set-recipe-active.dto';
import { UpdateRecipePhotoDto } from './dto/update-recipe-photo.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { UpdateRecipeSettingsDto } from './dto/update-recipe-settings.dto';
import { RecipesService } from './recipes.service';

const RECIPE_IMPORT_EXTENSIONS = new Set(['.xlsx', '.xls']);
const RECIPE_IMPORT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

type UploadFilterCallback = (error: Error | null, acceptFile: boolean) => void;

@Controller('recipes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get('settings')
  @Roles(...ALL_APP_ROLES)
  getSettings() {
    return this.recipes.getSettings();
  }

  @Patch('settings')
  @Roles(AppRole.Superadmin)
  updateSettings(@Body() dto: UpdateRecipeSettingsDto) {
    return this.recipes.updateSettings(dto);
  }

  @Post()
  @Roles(AppRole.Chef, AppRole.CorporateChef, AppRole.Superadmin)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRecipeDto) {
    return this.recipes.create(dto, this.buildActor(req, dto.site, true));
  }

  // BACKEND LOGIC: provide category options for recipe filters.
  @Get('categories')
  @Roles(...ALL_APP_ROLES)
  listCategories(
    @Req() req: AuthenticatedRequest,
    @Query('site') requestedSite?: string,
  ) {
    return this.recipes.listCategories(
      this.resolveQuerySite(req, requestedSite),
    );
  }

  @Get('drafts')
  @Roles(AppRole.Chef, AppRole.CorporateChef)
  listDrafts(@Req() req: AuthenticatedRequest) {
    return this.recipes.findDrafts(this.buildActor(req));
  }

  @Get()
  @Roles(...ALL_APP_ROLES)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListRecipesQueryDto) {
    return this.recipes.findAll(
      query,
      this.resolveListSites(req, query),
      req.user.roles?.includes(AppRole.Superadmin) ?? false,
    );
  }

  @Patch('ingredient-costs/backfill')
  @Roles(AppRole.Superadmin)
  backfillIngredientCosts(@Req() req: AuthenticatedRequest) {
    return this.recipes.backfillApprovedIngredientCosts(this.buildActor(req));
  }

  @Patch('ingredient-conversions/sync')
  @Roles(AppRole.Superadmin)
  syncIngredientConversions(@Req() req: AuthenticatedRequest) {
    return this.recipes.syncIngredientConversions(this.buildActor(req));
  }

  @Patch(':id')
  @Roles(AppRole.Chef, AppRole.CorporateChef, AppRole.Superadmin)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateRecipeDto,
  ) {
    return this.recipes.updateById(id, dto, this.buildActor(req));
  }

  @Patch(':id/submit-draft')
  @Roles(AppRole.Chef, AppRole.CorporateChef)
  submitDraft(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipes.submitDraft(id, this.buildActor(req));
  }

  @Patch(':id/active')
  @Roles(AppRole.Superadmin)
  setActive(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: SetRecipeActiveDto,
  ) {
    return this.recipes.setActive(id, dto.isActive, this.buildActor(req));
  }

  @Delete(':id')
  @Roles(AppRole.Superadmin)
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipes.softDeleteById(id, this.buildActor(req));
  }

  @Patch(':id/approve')
  @Roles(AppRole.UnitManager, AppRole.CorporateChef, AppRole.Superadmin)
  approve(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipes.setApprovalStatus(id, 'approved', this.buildActor(req));
  }

  @Patch(':id/reject')
  @Roles(AppRole.UnitManager, AppRole.CorporateChef, AppRole.Superadmin)
  reject(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RejectRecipeDto,
  ) {
    return this.recipes.setApprovalStatus(
      id,
      'rejected',
      this.buildActor(req),
      dto.reason,
    );
  }

  @Patch(':id/resubmit')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  resubmit(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ResubmitRecipeDto,
  ) {
    return this.recipes.resubmitRejectedRecipe(
      id,
      this.buildActor(req),
      dto.feedback,
    );
  }

  @Patch(':id/photo')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  updatePhoto(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateRecipePhotoDto,
  ) {
    return this.recipes.setImageUrl(id, dto.imageUrl, this.buildActor(req));
  }

  @Delete(':id/photo')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  removePhoto(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipes.clearImageUrl(id, this.buildActor(req));
  }

  @Post('import')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  @UseInterceptors(
    FileInterceptor('file', {
      dest: getUploadDir(),
      fileFilter: (
        _req: Request,
        file: { originalname: string; mimetype: string },
        cb: UploadFilterCallback,
      ) => {
        const ext = extname(file.originalname || '').toLowerCase();
        const isValidExt = RECIPE_IMPORT_EXTENSIONS.has(ext);
        const mime = (file.mimetype || '').toLowerCase();
        const isValidMime = RECIPE_IMPORT_MIME_TYPES.has(mime);
        if (!isValidExt || !isValidMime) {
          cb(
            new BadRequestException('Only .xlsx or .xls files are allowed'),
            false,
          );
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importRecipes(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: { path: string },
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    return this.recipes.importFromExcel(file.path, this.buildActor(req));
  }

  private buildActor(
    req: AuthenticatedRequest,
    requestedSite?: string,
    requireCorporateSite = false,
  ) {
    const site = this.resolveMutationSite(
      req,
      requestedSite,
      requireCorporateSite,
    );
    return {
      id: req.user.sub,
      name: req.user.name,
      email: req.user.email,
      roles: req.user.roles,
      site,
      sites: req.user.sites,
      corporateSite: req.user.corporateSite,
      approvalSites: req.user.approvalSites,
    };
  }

  private resolveMutationSite(
    req: AuthenticatedRequest,
    requestedSite?: string,
    required = false,
  ) {
    if (!req.user.roles?.includes(AppRole.CorporateChef)) {
      return getUserSiteScope(req.user);
    }

    if (req.user.corporateSite) {
      const ownerSite = getUserSiteScope(req.user);
      if (
        requestedSite?.trim() &&
        requestedSite.trim().toLowerCase() !== ownerSite?.toLowerCase()
      ) {
        throw new ForbiddenException(
          'Corporate recipes belong to your assigned corporate site.',
        );
      }
      return ownerSite;
    }

    const requested = requestedSite?.trim();
    if (!requested) {
      if (!required) return getUserSiteScope(req.user);
      throw new BadRequestException(
        'Select a site before creating the recipe.',
      );
    }

    const assignedSites = Array.from(
      new Set([req.user.site, ...(req.user.sites ?? [])]),
    )
      .map((site) => site?.trim())
      .filter((site): site is string => Boolean(site));
    const assignedSite = assignedSites.find(
      (site) => site.toLowerCase() === requested.toLowerCase(),
    );
    if (!assignedSite) {
      throw new ForbiddenException(
        'The selected site is not assigned to this Corporate Chef.',
      );
    }
    return assignedSite;
  }

  private resolveListSites(
    req: AuthenticatedRequest,
    query: ListRecipesQueryDto,
  ) {
    if (query.sites === undefined)
      return this.resolveQuerySite(req, query.site);
    if (query.site?.trim())
      throw new BadRequestException(
        'Use either site or sites as the recipe filter.',
      );
    const requested = query.sites.split(',').map((site) => site.trim());
    if (!requested.length || requested.some((site) => !site)) {
      throw new BadRequestException('Select at least one site.');
    }
    if (req.user.roles?.includes(AppRole.Superadmin))
      return Array.from(new Set(requested));
    if (!req.user.roles?.includes(AppRole.CorporateChef)) {
      throw new ForbiddenException(
        'Multiple site filters are only available to Corporate Chefs and Superadmins.',
      );
    }
    const allowed = [
      req.user.site,
      ...(req.user.corporateSite
        ? (req.user.approvalSites ?? [])
        : (req.user.sites ?? [])),
    ].filter((site): site is string => Boolean(site));
    const resolved = requested.map((site) => {
      const matched = allowed.find(
        (value) => value.toLowerCase() === site.toLowerCase(),
      );
      if (!matched)
        throw new ForbiddenException(
          'A selected site is outside your recipe scope.',
        );
      return matched;
    });
    return Array.from(new Set(resolved));
  }

  private resolveQuerySite(req: AuthenticatedRequest, requestedSite?: string) {
    if (
      req.user.roles?.includes(AppRole.CorporateChef) &&
      req.user.corporateSite
    ) {
      const allowed = [req.user.site, ...(req.user.approvalSites ?? [])].filter(
        (site): site is string => Boolean(site),
      );
      const requested = requestedSite?.trim();
      if (!requested) return req.user.approvalSites ?? [];
      const matched = allowed.find(
        (site) => site.toLowerCase() === requested.toLowerCase(),
      );
      if (!matched)
        throw new ForbiddenException(
          'The selected site is outside your recipe scope.',
        );
      return matched;
    }
    if (req.user.roles?.includes(AppRole.Executive)) {
      const assignedSites = Array.from(
        new Set([req.user.site, ...(req.user.sites ?? [])]),
      )
        .map((site) => site?.trim())
        .filter((site): site is string => Boolean(site));
      const requested = requestedSite?.trim();
      if (!requested) return req.user.site?.trim() || assignedSites[0];

      const assignedSite = assignedSites.find(
        (site) => site.toLowerCase() === requested.toLowerCase(),
      );
      if (!assignedSite) {
        throw new ForbiddenException(
          'The selected site is not assigned to this Executive.',
        );
      }
      return assignedSite;
    }

    if (req.user.roles?.includes(AppRole.CorporateChef)) {
      const assignedSites = (req.user.sites ?? []).map((site) =>
        site.trim().toLowerCase(),
      );
      const requested = requestedSite?.trim();
      if (requested && assignedSites.includes(requested.toLowerCase())) {
        return requested;
      }
      return req.user.site?.trim() || undefined;
    }
    const siteScope = getUserSiteScope(req.user);
    if (siteScope) return siteScope;
    return requestedSite?.trim() || undefined;
  }
}
