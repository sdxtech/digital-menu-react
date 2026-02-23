import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  // BACKEND LOGIC: chef dashboard data comes from backend.
  @Get('chef')
  chefSummary(@Req() req: AuthenticatedRequest) {
    return this.dashboard.getChefSummary(req.user.site);
  }
}
