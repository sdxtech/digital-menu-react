import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { PresignDto } from './dto/presign.dto';
import { FilesService } from './files.service';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('presign')
  presign(@Body() dto: PresignDto, @Req() _req: AuthenticatedRequest) {
    return this.files.presignUpload(dto.contentType, dto.prefix);
  }
}
