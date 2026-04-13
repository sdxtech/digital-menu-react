import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';
import { CreateSiteDto } from '../sites/dto/create-site.dto';
import { ListSitesQueryDto } from '../sites/dto/list-sites.query.dto';
import { SiteIdParamDto } from '../sites/dto/site-id.param.dto';
import { UpdateSiteStatusDto } from '../sites/dto/update-site-status.dto';
import { UpdateSiteDto } from '../sites/dto/update-site.dto';
import { SitesService } from '../sites/sites.service';

@Controller('superadmin/sites')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuperadminSitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @Roles(AppRole.Superadmin)
  list(@Query() query: ListSitesQueryDto) {
    return this.sites.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
      isActive: query.isActive,
    });
  }

  @Post()
  @Roles(AppRole.Superadmin)
  create(@Body() dto: CreateSiteDto) {
    return this.sites.create({
      name: dto.name,
      code: dto.code,
      description: dto.description,
      isActive: dto.isActive,
    });
  }

  @Get(':id')
  @Roles(AppRole.Superadmin)
  detail(@Param() params: SiteIdParamDto) {
    return this.sites.findById(params.id);
  }

  @Patch(':id/status')
  @Roles(AppRole.Superadmin)
  setStatus(@Param() params: SiteIdParamDto, @Body() dto: UpdateSiteStatusDto) {
    return this.sites.setActive(params.id, dto.isActive);
  }

  @Patch(':id')
  @Roles(AppRole.Superadmin)
  update(@Param() params: SiteIdParamDto, @Body() dto: UpdateSiteDto) {
    return this.sites.update(params.id, {
      name: dto.name,
      code: dto.code,
      description: dto.description,
      isActive: dto.isActive,
    });
  }

  @Delete(':id')
  @Roles(AppRole.Superadmin)
  remove(@Param() params: SiteIdParamDto) {
    return this.sites.softDelete(params.id);
  }
}
