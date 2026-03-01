import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  // BACKEND LOGIC: chef dashboard data comes from backend.
  @Get('chef')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  chefSummary(@Req() req: AuthenticatedRequest) {
    return this.dashboard.getChefSummary(req.user.site);
  }
}
