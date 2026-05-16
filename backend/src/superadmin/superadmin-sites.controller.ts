import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { extname, join } from 'path';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';
import { CreateSiteDto } from '../sites/dto/create-site.dto';
import { ListSitesQueryDto } from '../sites/dto/list-sites.query.dto';
import { SiteIdParamDto } from '../sites/dto/site-id.param.dto';
import { UpdateSiteStatusDto } from '../sites/dto/update-site-status.dto';
import { UpdateSiteDto } from '../sites/dto/update-site.dto';
import { SitesService } from '../sites/sites.service';

const SITE_IMPORT_EXTENSIONS = new Set(['.xlsx']);
const SITE_IMPORT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

type UploadFilterCallback = (error: Error | null, acceptFile: boolean) => void;

@Controller('superadmin/sites')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuperadminSitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @Roles(AppRole.Superadmin)
  list(@Query() query: ListSitesQueryDto) {
    return this.sites.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
      isActive: query.isActive,
    });
  }

  @Post()
  @Roles(AppRole.Superadmin)
  create(@Body() dto: CreateSiteDto) {
    return this.sites.create({
      name: dto.name,
      code: dto.code,
      description: dto.description,
      isActive: dto.isActive,
    });
  }

  @Post('import')
  @Roles(AppRole.Superadmin)
  @UseInterceptors(
    FileInterceptor('file', {
      dest: join(process.cwd(), 'uploads'),
      fileFilter: (
        _req: Request,
        file: { originalname: string; mimetype: string },
        cb: UploadFilterCallback,
      ) => {
        const ext = extname(file.originalname || '').toLowerCase();
        const mime = (file.mimetype || '').toLowerCase();
        if (
          !SITE_IMPORT_EXTENSIONS.has(ext) ||
          !SITE_IMPORT_MIME_TYPES.has(mime)
        ) {
          cb(new BadRequestException('Only .xlsx files are allowed'), false);
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  importSites(
    @UploadedFile()
    file?: {
      path: string;
      originalname: string;
      mimetype: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    return this.sites.importFromExcel(file.path);
  }

  @Get(':id')
  @Roles(AppRole.Superadmin)
  detail(@Param() params: SiteIdParamDto) {
    return this.sites.findById(params.id);
  }

  @Patch(':id/status')
  @Roles(AppRole.Superadmin)
  setStatus(@Param() params: SiteIdParamDto, @Body() dto: UpdateSiteStatusDto) {
    return this.sites.setActive(params.id, dto.isActive);
  }

  @Patch(':id')
  @Roles(AppRole.Superadmin)
  update(@Param() params: SiteIdParamDto, @Body() dto: UpdateSiteDto) {
    return this.sites.update(params.id, {
      name: dto.name,
      code: dto.code,
      description: dto.description,
      isActive: dto.isActive,
    });
  }

  @Delete(':id')
  @Roles(AppRole.Superadmin)
  remove(@Param() params: SiteIdParamDto) {
    return this.sites.delete(params.id);
  }
}
