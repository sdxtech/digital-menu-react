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
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { CreateMenuProductionDto } from './dto/create-menu-production.dto';
import { CreateMenuProductionBulkDto } from './dto/create-menu-production-bulk.dto';
import { ListMenuProductionsQueryDto } from './dto/list-menu-productions.query.dto';
import { MenuProductionsService } from './menu-productions.service';

@Controller('menu-productions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MenuProductionsController {
  constructor(private readonly menuProductions: MenuProductionsService) {}

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMenuProductionDto,
  ) {
    return this.menuProductions.create(dto, req.user.sub, req.user.site);
  }

  @Post('bulk')
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
  storeRequests(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMenuProductionsQueryDto,
  ) {
    return this.menuProductions.buildStoreRequestGroups(query, req.user.site);
  }

  // BACKEND LOGIC: timeline grouping + approval stats for production menus.
  @Get('timeline')
  timeline(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMenuProductionsQueryDto,
  ) {
    return this.menuProductions.buildTimeline(query, req.user.site);
  }

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: ListMenuProductionsQueryDto) {
    return this.menuProductions.findAll(query, req.user.site);
  }

  @Patch(':id/approve')
  approve(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.menuProductions.setApprovalStatus(id, 'approved', req.user.site);
  }

  @Patch(':id/reject')
  reject(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.menuProductions.setApprovalStatus(id, 'rejected', req.user.site);
  }

  @Patch(':id/store-request')
  markStoreRequested(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.menuProductions.setStoreRequestStatus(
      id,
      'requested',
      req.user.site,
    );
  }

  @Patch(':id/fulfill')
  markStoreFulfilled(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.menuProductions.setStoreRequestStatus(
      id,
      'fulfilled',
      req.user.site,
    );
  }
}
