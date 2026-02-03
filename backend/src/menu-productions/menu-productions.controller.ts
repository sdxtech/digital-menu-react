import {
  Body,
  Controller,
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
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { CreateMenuProductionDto } from './dto/create-menu-production.dto';
import { CreateMenuProductionBulkDto } from './dto/create-menu-production-bulk.dto';
import { ListMenuProductionsQueryDto } from './dto/list-menu-productions.query.dto';
import { MenuProductionsService } from './menu-productions.service';

@Controller('menu-productions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MenuProductionsController {
  constructor(private readonly menuProductions: MenuProductionsService) {}

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMenuProductionDto,
  ) {
    return this.menuProductions.create(dto, req.user.sub);
  }

  @Post('bulk')
  createBulk(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMenuProductionBulkDto,
  ) {
    return this.menuProductions.createMany(dto.items ?? [], req.user.sub);
  }

  @Get()
  list(@Query() query: ListMenuProductionsQueryDto) {
    return this.menuProductions.findAll(query);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.menuProductions.setApprovalStatus(id, 'approved');
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string) {
    return this.menuProductions.setApprovalStatus(id, 'rejected');
  }

  @Patch(':id/store-request')
  markStoreRequested(@Param('id') id: string) {
    return this.menuProductions.setStoreRequestStatus(id, 'requested');
  }

  @Patch(':id/fulfill')
  markStoreFulfilled(@Param('id') id: string) {
    return this.menuProductions.setStoreRequestStatus(id, 'fulfilled');
  }
}
