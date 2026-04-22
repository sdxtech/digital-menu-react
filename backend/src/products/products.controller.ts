import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { getUserSiteScope } from '../auth/site-scope';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
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
  @Roles(AppRole.Superadmin)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateProductDto) {
    return this.products.create(
      {
        name: dto.name,
        price: dto.price,
        categoryId: dto.categoryId,
        description: dto.description,
        imageUrl: dto.imageUrl,
        isActive: dto.isActive,
      },
      getUserSiteScope(req.user),
    );
  }

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: ListProductsQueryDto) {
    return this.products.findAll(
      {
        page: query.page ?? 1,
        limit: query.limit ?? 20,
        search: query.search,
        categoryId: query.categoryId,
        isActive: query.isActive ?? true,
        sortBy: query.sortBy ?? 'createdAt',
        sortDir: query.sortDir ?? 'desc',
      },
      getUserSiteScope(req.user),
    );
  }

  @Get(':id')
  detail(@Req() req: AuthenticatedRequest, @Param() params: ProductIdParamDto) {
    return this.products.findById(params.id, getUserSiteScope(req.user));
  }

  @Patch(':id')
  @Roles(AppRole.Superadmin)
  update(
    @Req() req: AuthenticatedRequest,
    @Param() params: ProductIdParamDto,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(
      params.id,
      {
        name: dto.name,
        price: dto.price,
        categoryId: dto.categoryId,
        description: dto.description,
        imageUrl: dto.imageUrl,
        isActive: dto.isActive,
      },
      getUserSiteScope(req.user),
    );
  }

  @Delete(':id')
  @Roles(AppRole.Superadmin)
  remove(@Req() req: AuthenticatedRequest, @Param() params: ProductIdParamDto) {
    return this.products.softDelete(params.id, getUserSiteScope(req.user));
  }
}
