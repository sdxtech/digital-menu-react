import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ALL_APP_ROLES, AppRole } from '../auth/roles.constants';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { DashboardAccessService } from './dashboard-access.service';
import { UpdateDashboardAccessDto } from './dto/update-dashboard-access.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardAccessController {
  constructor(private readonly access: DashboardAccessService) {}

  @Get('access')
  @Roles(...ALL_APP_ROLES)
  ownAccess(@Req() req: AuthenticatedRequest) {
    return this.access.getAccess(req.user.sub);
  }

  @Get('analytics')
  @Roles(...ALL_APP_ROLES)
  analytics(
    @Req() req: AuthenticatedRequest,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.access.analytics(req.user.sub, query);
  }

  @Get('clients')
  @Roles(...ALL_APP_ROLES)
  clients(@Req() req: AuthenticatedRequest, @Query('site') site?: string) {
    return this.access.clientOptions(req.user.sub, site?.trim());
  }

  @Get('access-settings/:type/:id')
  @Roles(AppRole.Superadmin)
  settings(@Param('type') type: string, @Param('id') id: string) {
    return this.access.getSettings(type, id);
  }

  @Put('access-settings/:type/:id')
  @Roles(AppRole.Superadmin)
  save(
    @Req() req: AuthenticatedRequest,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: UpdateDashboardAccessDto,
  ) {
    return this.access.saveSettings(type, id, dto, req.user.sub);
  }
}
