import {
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
    return this.menuProductions.create(
      dto,
      req.user.sub,
      getUserSiteScope(req.user),
    );
  }

  @Post('bulk')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  createBulk(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMenuProductionBulkDto,
  ) {
    return this.menuProductions.createMany(
      dto.items ?? [],
      req.user.sub,
      getUserSiteScope(req.user),
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
      getUserSiteScope(req.user),
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
      getUserSiteScope(req.user),
    );
  }

  @Get()
  @Roles(...ALL_APP_ROLES)
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMenuProductionsQueryDto,
  ) {
    return this.menuProductions.findAll(query, getUserSiteScope(req.user));
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
    );
  }

  @Patch(':id/reject')
  @Roles(AppRole.UnitManager, AppRole.Superadmin)
  reject(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.menuProductions.setApprovalStatus(
      id,
      'rejected',
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
}
