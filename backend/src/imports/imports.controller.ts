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
import { extname } from 'path';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { getUserSiteScope } from '../auth/site-scope';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { getUploadDir } from '../common/upload-dir';
import { ImportDto } from './dto/import.dto';
import { ImportsService } from './imports.service';

const RAW_MATERIAL_IMPORT_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const RAW_MATERIAL_IMPORT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'application/octet-stream',
]);

type UploadFilterCallback = (error: Error | null, acceptFile: boolean) => void;

@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('products')
  @Roles(AppRole.Superadmin)
  async importProducts(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ImportDto,
  ) {
    return this.importsService.enqueueProducts(
      req.user.sub,
      dto.fileKey,
      dto.fileName,
      dto.contentType,
      getUserSiteScope(req.user),
    );
  }

  @Post('raw-materials')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  async importRawMaterials(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ImportDto,
  ) {
    return this.importsService.enqueueRawMaterials(
      req.user.sub,
      dto.fileKey,
      dto.fileName,
      dto.contentType,
    );
  }

  @Post('raw-materials/upload')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  @UseInterceptors(
    FileInterceptor('file', {
      dest: getUploadDir(),
      fileFilter: (
        _req: Request,
        file: { originalname: string; mimetype: string },
        cb: UploadFilterCallback,
      ) => {
        const ext = extname(file.originalname || '').toLowerCase();
        const isValidExt = RAW_MATERIAL_IMPORT_EXTENSIONS.has(ext);
        const mime = (file.mimetype || '').toLowerCase();
        const isValidMime = RAW_MATERIAL_IMPORT_MIME_TYPES.has(mime);
        if (!isValidExt || !isValidMime) {
          cb(
            new BadRequestException(
              'Only .xlsx, .xls, or .csv files are allowed',
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importRawMaterialsUpload(
    @Req() req: AuthenticatedRequest,
    @UploadedFile()
    file?: { path: string; originalname: string; mimetype: string },
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
