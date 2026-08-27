import {
  Body,
  Controller,
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
import { CreateMenuGroupDto } from './dto/create-menu-group.dto';
import { ListMenuGroupsQueryDto } from './dto/list-menu-groups.query.dto';
import { MenuGroupIdParamDto } from './dto/menu-group-id.param.dto';
import { UpdateMenuGroupDto } from './dto/update-menu-group.dto';
import { MenuGroupsService } from './menu-groups.service';

@Controller('menu-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MenuGroupsController {
  constructor(private readonly menuGroups: MenuGroupsService) {}

  @Post()
  @Roles(AppRole.Superadmin)
  create(@Body() dto: CreateMenuGroupDto) {
    return this.menuGroups.create(dto);
  }

  @Get()
  list(@Query() query: ListMenuGroupsQueryDto) {
    return this.menuGroups.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
      isActive: query.isActive ?? true,
    });
  }

  @Patch(':id')
  @Roles(AppRole.Superadmin)
  update(
    @Param() params: MenuGroupIdParamDto,
    @Body() dto: UpdateMenuGroupDto,
  ) {
    return this.menuGroups.update(params.id, dto);
  }
}
