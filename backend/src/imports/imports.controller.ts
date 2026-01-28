import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { ImportDto } from './dto/import.dto';
import { ImportsService } from './imports.service';

@Controller('imports')
@UseGuards(JwtAuthGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() dto: ImportDto) {
    return this.importsService.enqueue(req.user.sub, dto.fileKey, dto.kind);
  }
}
