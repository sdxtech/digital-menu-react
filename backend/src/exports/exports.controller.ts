import {
  Body,
  ForbiddenException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { getUserSiteScope } from '../auth/site-scope';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { ExportsService } from './exports.service';
import { ExportRecipesDto } from './dto/export-recipes.dto';
import { resolveRecipeReadSite } from '../recipes/recipe-read-scope';

const RECIPE_EXPORT_ROLES = [
  AppRole.Superadmin,
  AppRole.Chef,
  AppRole.UnitManager,
  AppRole.CorporateChef,
  AppRole.Executive,
];

@Controller('exports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Post('recipes')
  @Roles(...RECIPE_EXPORT_ROLES)
  exportRecipes(
    @Req() req: AuthenticatedRequest,
    @Body() input: ExportRecipesDto,
  ) {
    return this.exportsService.enqueueRecipes(
      req.user.sub,
      input,
      this.recipeScope(req, input),
    );
  }

  @Get('recipes/:jobId')
  @Roles(...RECIPE_EXPORT_ROLES)
  recipeStatus(
    @Req() req: AuthenticatedRequest,
    @Param('jobId') jobId: string,
  ) {
    return this.exportsService.recipeStatus(req.user.sub, jobId);
  }

  @Post('recipes/count')
  @Roles(...RECIPE_EXPORT_ROLES)
  recipeCount(
    @Req() req: AuthenticatedRequest,
    @Body() input: ExportRecipesDto,
  ) {
    return this.exportsService.recipeCount(input, this.recipeScope(req, input));
  }

  @Get('recipes/:jobId/download')
  @Roles(...RECIPE_EXPORT_ROLES)
  recipeDownload(
    @Req() req: AuthenticatedRequest,
    @Param('jobId') jobId: string,
  ) {
    return this.exportsService.recipeDownload(req.user.sub, jobId);
  }

  private recipeScope(req: AuthenticatedRequest, input: ExportRecipesDto) {
    const includeInactive = req.user.roles.includes(AppRole.Superadmin);
    const strictSite =
      !includeInactive && req.user.roles.includes(AppRole.Executive);
    const site = includeInactive
      ? undefined
      : resolveRecipeReadSite(req.user, strictSite ? input.site : undefined);
    if (strictSite && !site) {
      throw new ForbiddenException(
        'Select an assigned site before exporting recipes.',
      );
    }
    return { site, includeInactive, strictSite };
  }

  @Post('products')
  @Roles(AppRole.Superadmin)
  exportProducts(@Req() req: AuthenticatedRequest) {
    return this.exportsService.enqueueProducts(
      req.user.sub,
      getUserSiteScope(req.user),
    );
  }
}
