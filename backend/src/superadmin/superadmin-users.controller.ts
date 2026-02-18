import { Body, Controller, Delete, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { UsersService } from '../users/users.service';
import { ListUsersQueryDto } from '../users/dto/list-users.query.dto';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { UpdateUserPasswordDto } from '../users/dto/update-user-password.dto';

@Controller('superadmin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuperadminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(AppRole.Superadmin)
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
    });
  }

  @Patch(':id')
  @Roles(AppRole.Superadmin)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateById(id, { name: dto.name, email: dto.email });
  }

  @Patch(':id/password')
  @Roles(AppRole.Superadmin)
  updatePassword(@Param('id') id: string, @Body() dto: UpdateUserPasswordDto) {
    return this.users.updatePassword(id, dto.password);
  }

  @Delete(':id')
  @Roles(AppRole.Superadmin)
  remove(@Param('id') id: string) {
    return this.users.deleteById(id);
  }
}
