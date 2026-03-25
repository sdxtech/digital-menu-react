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
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
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
    return this.menuProductions.create(dto, req.user.sub, req.user.site);
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
      req.user.site,
    );
  }

  // BACKEND LOGIC: store-request aggregation lives here (qty multiplier + summary)
  @Get('store-requests')
  @Roles(...ALL_APP_ROLES)
  storeRequests(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMenuProductionsQueryDto,
  ) {
    return this.menuProductions.buildStoreRequestGroups(query, req.user.site);
  }

  // BACKEND LOGIC: timeline grouping + approval stats for production menus.
  @Get('timeline')
  @Roles(...ALL_APP_ROLES)
  timeline(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMenuProductionsQueryDto,
  ) {
    return this.menuProductions.buildTimeline(query, req.user.site);
  }

  @Get()
  @Roles(...ALL_APP_ROLES)
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMenuProductionsQueryDto,
  ) {
    return this.menuProductions.findAll(query, req.user.site);
  }

  @Patch('fulfill-batch')
  @Roles(AppRole.Storekeeper, AppRole.Superadmin)
  fulfillBatch(
    @Req() req: AuthenticatedRequest,
    @Body() dto: FulfillStoreRequestBatchDto,
  ) {
    return this.menuProductions.fulfillStoreRequestBatch(
      dto,
      req.user.site,
      req.user.name || req.user.email,
    );
  }

  @Patch(':id/approve')
  @Roles(AppRole.UnitManager, AppRole.Superadmin)
  approve(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.menuProductions.setApprovalStatus(
      id,
      'approved',
      req.user.site,
      req.user.name || req.user.email,
    );
  }

  @Patch(':id/reject')
  @Roles(AppRole.UnitManager, AppRole.Superadmin)
  reject(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.menuProductions.setApprovalStatus(
      id,
      'rejected',
      req.user.site,
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
      req.user.site,
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
      req.user.site,
      req.user.name || req.user.email,
    );
  }
}
