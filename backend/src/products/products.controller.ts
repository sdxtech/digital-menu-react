import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query.dto';
import { ProductIdParamDto } from './dto/product-id.param.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @Roles(AppRole.Admin, AppRole.Staff)
  create(@Body() dto: CreateProductDto) {
    return this.products.create({
      name: dto.name,
      price: dto.price,
      categoryId: dto.categoryId,
      description: dto.description,
      imageUrl: dto.imageUrl,
      isActive: dto.isActive,
    });
  }

  @Get()
  list(@Query() query: ListProductsQueryDto) {
    return this.products.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
      categoryId: query.categoryId,
      isActive: query.isActive ?? true,
      sortBy: query.sortBy ?? 'createdAt',
      sortDir: query.sortDir ?? 'desc',
    });
  }

  @Get(':id')
  detail(@Param() params: ProductIdParamDto) {
    return this.products.findById(params.id);
  }

  @Patch(':id')
  @Roles(AppRole.Admin, AppRole.Staff)
  update(@Param() params: ProductIdParamDto, @Body() dto: UpdateProductDto) {
    return this.products.update(params.id, {
      name: dto.name,
      price: dto.price,
      categoryId: dto.categoryId,
      description: dto.description,
      imageUrl: dto.imageUrl,
      isActive: dto.isActive,
    });
  }

  @Delete(':id')
  @Roles(AppRole.Admin)
  remove(@Param() params: ProductIdParamDto) {
    return this.products.softDelete(params.id);
  }
}
