import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { PresignDto } from './dto/presign.dto';
import { FilesService } from './files.service';

@Controller('files')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('presign')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  presign(@Body() dto: PresignDto) {
    return this.files.presignUpload(dto.contentType, dto.prefix, dto.fileSize);
  }
}
