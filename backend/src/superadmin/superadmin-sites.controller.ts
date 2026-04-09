import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { SitesService } from '../sites/sites.service';
import { CreateSiteDto } from '../sites/dto/create-site.dto';
import { ListSitesQueryDto } from '../sites/dto/list-sites.query.dto';
import { UpdateSiteDto } from '../sites/dto/update-site.dto';

@Controller('superadmin/sites')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuperadminSitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @Roles(AppRole.Superadmin)
  list(@Query() query: ListSitesQueryDto) {
    return this.sites.list({
      search: query.search,
      active: query.active,
    });
  }

  @Post()
  @Roles(AppRole.Superadmin)
  create(@Body() dto: CreateSiteDto) {
    return this.sites.create({
      code: dto.code,
      name: dto.name,
    });
  }

  @Patch(':id')
  @Roles(AppRole.Superadmin)
  update(@Param('id') id: string, @Body() dto: UpdateSiteDto) {
    return this.sites.update(id, {
      name: dto.name,
      isActive: dto.isActive,
    });
  }
}
