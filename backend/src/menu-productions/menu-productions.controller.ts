import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole, ALL_APP_ROLES } from '../auth/roles.constants';
import { getUserSiteScope } from '../auth/site-scope';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { CancelPendingMenuProductionBatchDto } from './dto/cancel-pending-menu-production-batch.dto';
import { CancelStoreRequestBatchDto } from './dto/cancel-store-request-batch.dto';
import { CreateMenuProductionDto } from './dto/create-menu-production.dto';
import { CreateMenuProductionBulkDto } from './dto/create-menu-production-bulk.dto';
import { FulfillStoreRequestBatchDto } from './dto/fulfill-store-request-batch.dto';
import { ListMenuProductionsQueryDto } from './dto/list-menu-productions.query.dto';
import { RejectMenuProductionDto } from './dto/reject-menu-production.dto';
import { UpdateMenuProductionSalesDetailsDto } from './dto/update-menu-production-sales-details.dto';
import { UpdateMenuProductionBatchSalesDetailsDto } from './dto/update-menu-production-batch-sales-details.dto';
import { MenuProductionsService } from './menu-productions.service';

@Controller('menu-productions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MenuProductionsController {
  constructor(private readonly menuProductions: MenuProductionsService) {}

  @Post()
  @Roles(AppRole.Chef, AppRole.Superadmin)
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMenuProductionDto,
  ) {
    this.requireCreateUnitManager(req, dto.unitManagerId);
    return this.menuProductions.create(
      dto,
      this.resolveCreateChef(req, dto.chefId),
      this.resolveCreateSite(req, dto.site),
      this.resolveAssistedBy(req),
    );
  }

  @Post('bulk')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  createBulk(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMenuProductionBulkDto,
  ) {
    const requestedSites = Array.from(
      new Set(
        (dto.items ?? [])
          .map((item) => item.site?.trim())
          .filter((site): site is string => Boolean(site)),
      ),
    );
    if (requestedSites.length > 1) {
      throw new BadRequestException(
        'Bulk menu production can only target one site at a time.',
      );
    }
    const requestedChefIds = this.getUniqueRequestValues(
      dto.items ?? [],
      'chefId',
    );
    if (requestedChefIds.length > 1) {
      throw new BadRequestException(
        'Bulk menu production can only target one chef at a time.',
      );
    }
    const requestedUnitManagerIds = this.getUniqueRequestValues(
      dto.items ?? [],
      'unitManagerId',
    );
    if (requestedUnitManagerIds.length > 1) {
      throw new BadRequestException(
        'Bulk menu production can only target one unit manager at a time.',
      );
    }
    this.requireCreateUnitManager(req, requestedUnitManagerIds[0]);

    return this.menuProductions.createMany(
      dto.items ?? [],
      this.resolveCreateChef(req, requestedChefIds[0]),
      this.resolveCreateSite(req, requestedSites[0]),
      this.resolveAssistedBy(req),
    );
  }

  // BACKEND LOGIC: store-request aggregation lives here (qty multiplier + summary)
  @Get('store-requests')
  @Roles(...ALL_APP_ROLES)
  storeRequests(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMenuProductionsQueryDto,
  ) {
    return this.menuProductions.buildStoreRequestGroups(
      query,
      this.resolveQuerySite(req, query.site),
      this.resolveUnitManagerAssignmentScope(req),
      req.user.roles?.includes(AppRole.UnitManager) ||
        (req.user.roles?.includes(AppRole.Superadmin) &&
          query.approvalStatus === 'pending'),
    );
  }

  // BACKEND LOGIC: timeline grouping + approval stats for production menus.
  @Get('timeline')
  @Roles(...ALL_APP_ROLES)
  timeline(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMenuProductionsQueryDto,
  ) {
    return this.menuProductions.buildTimeline(
      query,
      this.resolveQuerySite(req, query.site),
      this.resolveUnitManagerAssignmentScope(req),
    );
  }

  @Get()
  @Roles(...ALL_APP_ROLES)
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMenuProductionsQueryDto,
  ) {
    return this.menuProductions.findAll(
      query,
      this.resolveQuerySite(req, query.site),
      this.resolveUnitManagerAssignmentScope(req),
    );
  }

  @Patch('fulfill-batch')
  @Roles(AppRole.Storekeeper, AppRole.Superadmin)
  fulfillBatch(
    @Req() req: AuthenticatedRequest,
    @Body() dto: FulfillStoreRequestBatchDto,
  ) {
    return this.menuProductions.fulfillStoreRequestBatch(
      dto,
      getUserSiteScope(req.user),
      req.user.name || req.user.email,
      { allowStatusOverride: req.user.roles?.includes(AppRole.Superadmin) },
    );
  }

  @Patch('cancel-batch')
  @Roles(AppRole.Storekeeper, AppRole.Superadmin)
  cancelBatch(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CancelStoreRequestBatchDto,
  ) {
    return this.menuProductions.cancelStoreRequestBatch(
      dto,
      getUserSiteScope(req.user),
      req.user.name || req.user.email,
      { allowStatusOverride: req.user.roles?.includes(AppRole.Superadmin) },
    );
  }

  @Patch('cancel-pending-batch')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  cancelPendingBatch(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CancelPendingMenuProductionBatchDto,
  ) {
    return this.menuProductions.cancelPendingMenuProductionBatch(
      dto,
      getUserSiteScope(req.user),
    );
  }

  @Patch(':id/approve')
  @Roles(AppRole.UnitManager, AppRole.Superadmin)
  approve(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.menuProductions.setApprovalStatus(
      id,
      'approved',
      getUserSiteScope(req.user),
      req.user.name || req.user.email,
      this.resolveUnitManagerAssignmentScope(req),
    );
  }

  @Patch(':id/reject')
  @Roles(AppRole.UnitManager, AppRole.Superadmin)
  reject(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RejectMenuProductionDto,
  ) {
    return this.menuProductions.setApprovalStatus(
      id,
      'rejected',
      getUserSiteScope(req.user),
      req.user.name || req.user.email,
      this.resolveUnitManagerAssignmentScope(req),
      dto.reason,
    );
  }

  @Patch('batch/sales-details')
  @Roles(AppRole.AdminSite, AppRole.Superadmin)
  updateBatchSalesDetails(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateMenuProductionBatchSalesDetailsDto,
  ) {
    return this.menuProductions.updateBatchSalesDetails(
      dto.productionCode,
      dto,
      getUserSiteScope(req.user),
      req.user.name || req.user.email,
    );
  }

  @Patch(':id/sales-details')
  @Roles(AppRole.AdminSite, AppRole.Superadmin)
  updateSalesDetails(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateMenuProductionSalesDetailsDto,
  ) {
    return this.menuProductions.updateSalesDetails(
      id,
      dto,
      getUserSiteScope(req.user),
      req.user.name || req.user.email,
    );
  }

  @Patch(':id/store-request')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  markStoreRequested(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.menuProductions.setStoreRequestStatus(
      id,
      'requested',
      getUserSiteScope(req.user),
    );
  }

  @Patch(':id/fulfill')
  @Roles(AppRole.Storekeeper, AppRole.Superadmin)
  markStoreFulfilled(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.menuProductions.setStoreRequestStatus(
      id,
      'fulfilled',
      getUserSiteScope(req.user),
      req.user.name || req.user.email,
    );
  }

  private resolveCreateSite(req: AuthenticatedRequest, requestedSite?: string) {
    const siteScope = getUserSiteScope(req.user);
    if (siteScope) return siteScope;

    const normalizedSite = requestedSite?.trim();
    if (!normalizedSite) {
      throw new BadRequestException('Menu production requires a site.');
    }
    return normalizedSite;
  }

  private resolveCreateChef(req: AuthenticatedRequest, requestedChefId?: string) {
    const siteScope = getUserSiteScope(req.user);
    if (siteScope) return req.user.sub;

    const normalizedChefId = requestedChefId?.trim();
    if (!normalizedChefId) {
      throw new BadRequestException('Menu production requires a chef.');
    }
    return normalizedChefId;
  }

  private resolveAssistedBy(req: AuthenticatedRequest) {
    const siteScope = getUserSiteScope(req.user);
    return siteScope ? undefined : req.user.sub;
  }

  private requireCreateUnitManager(
    req: AuthenticatedRequest,
    requestedUnitManagerId?: string,
  ) {
    const siteScope = getUserSiteScope(req.user);
    if (siteScope) return;

    if (!requestedUnitManagerId?.trim()) {
      throw new BadRequestException(
        'Menu production requires a unit manager.',
      );
    }
  }

  private resolveQuerySite(req: AuthenticatedRequest, requestedSite?: string) {
    const siteScope = getUserSiteScope(req.user);
    if (siteScope) return siteScope;
    return requestedSite?.trim() || undefined;
  }

  private resolveUnitManagerAssignmentScope(req: AuthenticatedRequest) {
    if (req.user.roles?.includes(AppRole.Superadmin)) return undefined;
    return req.user.roles?.includes(AppRole.UnitManager)
      ? req.user.sub
      : undefined;
  }

  private getUniqueRequestValues(
    items: CreateMenuProductionDto[],
    key: 'chefId' | 'unitManagerId',
  ) {
    return Array.from(
      new Set(
        items
          .map((item) => item[key]?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
  }
}
