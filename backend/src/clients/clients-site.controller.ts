import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';
import { ClientsService } from './clients.service';

@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientsSiteController {
  constructor(private readonly clients: ClientsService) {}

  @Get('by-site/:siteCode')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  listForSite(@Param('siteCode') siteCode: string) {
    return this.clients.findForSite(siteCode);
  }
}
