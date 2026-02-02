import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { ListRawMaterialsQueryDto } from './dto/list-raw-materials.query.dto';
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
}

