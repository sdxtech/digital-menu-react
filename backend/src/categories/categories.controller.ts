import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { CategoriesService } from './categories.service';
import { CategoryIdParamDto } from './dto/category-id.param.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories.query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post()
  @Roles(AppRole.Superadmin)
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create({ name: dto.name, isActive: dto.isActive });
  }

  @Get()
  list(@Query() query: ListCategoriesQueryDto) {
    return this.categories.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
      isActive: query.isActive ?? true,
    });
  }

  @Patch(':id')
  @Roles(AppRole.Superadmin)
  update(@Param() params: CategoryIdParamDto, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(params.id, { name: dto.name, isActive: dto.isActive });
  }

  @Delete(':id')
  @Roles(AppRole.Superadmin)
  remove(@Param() params: CategoryIdParamDto) {
    return this.categories.softDelete(params.id);
  }
}
