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
import { CreateUnitConversionDto } from './dto/create-unit-conversion.dto';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { ListUnitOfMeasuresQueryDto } from './dto/list-unit-of-measures.query.dto';
import { UpdateUnitConversionDto } from './dto/update-unit-conversion.dto';
import { UpdateUnitOfMeasureDto } from './dto/update-unit-of-measure.dto';
import { UnitOfMeasuresService } from './unit-of-measures.service';

@Controller('unit-of-measures')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AppRole.Superadmin)
export class UnitOfMeasuresController {
  constructor(private readonly unitOfMeasures: UnitOfMeasuresService) {}

  @Get()
  @Roles(AppRole.Chef, AppRole.CorporateChef, AppRole.Superadmin)
  listUnits(@Query() query: ListUnitOfMeasuresQueryDto) {
    return this.unitOfMeasures.listUnits({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
      isActive:
        query.isActive === undefined ? undefined : query.isActive === 'true',
    });
  }

  @Post()
  createUnit(@Body() dto: CreateUnitOfMeasureDto) {
    return this.unitOfMeasures.createUnit(dto);
  }

  @Patch(':id')
  updateUnit(@Param('id') id: string, @Body() dto: UpdateUnitOfMeasureDto) {
    return this.unitOfMeasures.updateUnit(id, dto);
  }

  @Delete(':id')
  deleteUnit(@Param('id') id: string) {
    return this.unitOfMeasures.deleteUnit(id);
  }

  @Get('conversions')
  @Roles(AppRole.Chef, AppRole.CorporateChef, AppRole.Superadmin)
  listConversions(@Query() query: ListUnitOfMeasuresQueryDto) {
    return this.unitOfMeasures.listConversions({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
      isActive:
        query.isActive === undefined ? undefined : query.isActive === 'true',
    });
  }

  @Post('conversions')
  createConversion(@Body() dto: CreateUnitConversionDto) {
    return this.unitOfMeasures.createConversion(dto);
  }

  @Patch('conversions/:id')
  updateConversion(
    @Param('id') id: string,
    @Body() dto: UpdateUnitConversionDto,
  ) {
    return this.unitOfMeasures.updateConversion(id, dto);
  }

  @Delete('conversions/:id')
  deleteConversion(@Param('id') id: string) {
    return this.unitOfMeasures.deleteConversion(id);
  }
}
