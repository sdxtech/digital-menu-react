import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  // BACKEND LOGIC: chef dashboard data comes from backend.
  @Get('chef')
  chefSummary() {
    return this.dashboard.getChefSummary();
  }
}
