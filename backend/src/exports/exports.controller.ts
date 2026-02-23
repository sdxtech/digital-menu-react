import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { ExportsService } from './exports.service';

@Controller('exports')
@UseGuards(JwtAuthGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Post('products')
  exportProducts(@Req() req: AuthenticatedRequest) {
    return this.exportsService.enqueueProducts(req.user.sub, req.user.site);
  }
}
