import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';
import { CreateClientDto } from './dto/create-client.dto';
import { ListClientsQueryDto } from './dto/list-clients.query.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientsService } from './clients.service';

@Controller('superadmin/clients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @Roles(AppRole.Superadmin)
  list(@Query() query: ListClientsQueryDto) {
    return this.clients.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 10,
      search: query.search,
    });
  }

  @Post()
  @Roles(AppRole.Superadmin)
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }

  @Get('by-site/:siteCode')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  listForSite(@Param('siteCode') siteCode: string) {
    return this.clients.findForSite(siteCode);
  }

  @Patch(':id')
  @Roles(AppRole.Superadmin)
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(id, dto);
  }

  @Delete(':id')
  @Roles(AppRole.Superadmin)
  remove(@Param('id') id: string) {
    return this.clients.remove(id);
  }
}
