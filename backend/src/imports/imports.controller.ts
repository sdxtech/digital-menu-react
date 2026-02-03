import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import fs from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { ImportDto } from './dto/import.dto';
import { ImportsService } from './imports.service';

@Controller('imports')
@UseGuards(JwtAuthGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('products')
  async importProducts(@Req() req: AuthenticatedRequest, @Body() dto: ImportDto) {
    return this.importsService.enqueueProducts(
      req.user.sub,
      dto.fileKey,
      dto.fileName,
      dto.contentType,
    );
  }

  @Post('raw-materials')
  async importRawMaterials(@Req() req: AuthenticatedRequest, @Body() dto: ImportDto) {
    return this.importsService.enqueueRawMaterials(
      req.user.sub,
      dto.fileKey,
      dto.fileName,
      dto.contentType,
    );
  }

  @Post('raw-materials/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadDir = join(process.cwd(), 'uploads');
          fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname);
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 200 * 1024 * 1024 },
    }),
  )
  async importRawMaterialsUpload(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: { path: string; originalname: string; mimetype: string },
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    return this.importsService.enqueueRawMaterials(
      req.user.sub,
      undefined,
      file.originalname,
      file.mimetype,
      file.path,
    );
  }
}
