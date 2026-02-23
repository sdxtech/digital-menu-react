import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { ListRawMaterialsQueryDto } from './dto/list-raw-materials.query.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { RawMaterialsService } from './raw-materials.service';

@Controller('raw-materials')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RawMaterialsController {
  constructor(private readonly rawMaterials: RawMaterialsService) {}

  @Post()
  create(@Body() dto: CreateRawMaterialDto) {
    return this.rawMaterials.create({
      productCode: dto.productCode,
      name: dto.name,
      unitOfMeasures: dto.unitOfMeasures,
      site: dto.site,
      vendor: dto.vendor,
      currency: dto.currency,
      minimumQuantity: dto.minimumQuantity,
      price: dto.price,
    });
  }

  @Get()
  list(@Query() query: ListRawMaterialsQueryDto) {
    return this.rawMaterials.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRawMaterialDto) {
    return this.rawMaterials.updateById(id, {
      productCode: dto.productCode,
      name: dto.name,
      unitOfMeasures: dto.unitOfMeasures,
      site: dto.site,
      vendor: dto.vendor,
      currency: dto.currency,
      minimumQuantity: dto.minimumQuantity,
      price: dto.price,
    });
  }
}
