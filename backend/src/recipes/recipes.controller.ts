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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { promises as fs } from 'fs';
import type { Request } from 'express';
import ExcelJS from 'exceljs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole, ALL_APP_ROLES } from '../auth/roles.constants';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { ListRecipesQueryDto } from './dto/list-recipes.query.dto';
import { UpdateRecipePhotoDto } from './dto/update-recipe-photo.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { RecipesService } from './recipes.service';

const RECIPE_HEADER_ALIASES = {
  name: ['name', 'nama', 'menu', 'menu name'],
  category: ['category', 'kategori', 'jenis'],
  description: ['description', 'deskripsi', 'desc'],
  price: ['price', 'harga'],
  status: ['status', 'state'],
  portionSize: ['portion', 'portions', 'porsi', 'serving', 'servings', 'yield'],
};

const RECIPE_IMPORT_EXTENSIONS = new Set(['.xlsx', '.xls']);
const RECIPE_IMPORT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

@Controller('recipes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Post()
  @Roles(AppRole.Chef, AppRole.Superadmin)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRecipeDto) {
    return this.recipes.create(dto, this.buildActor(req));
  }

  // BACKEND LOGIC: provide category options for recipe filters.
  @Get('categories')
  @Roles(...ALL_APP_ROLES)
  listCategories(@Req() req: AuthenticatedRequest) {
    return this.recipes.listCategories(req.user.site);
  }

  @Get()
  @Roles(...ALL_APP_ROLES)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListRecipesQueryDto) {
    return this.recipes.findAll(query, req.user.site);
  }

  @Patch(':id')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateRecipeDto,
  ) {
    return this.recipes.updateById(id, dto, this.buildActor(req));
  }

  @Patch(':id/approve')
  @Roles(AppRole.UnitManager, AppRole.Superadmin)
  approve(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipes.setApprovalStatus(id, 'approved', this.buildActor(req));
  }

  @Patch(':id/reject')
  @Roles(AppRole.UnitManager, AppRole.Superadmin)
  reject(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipes.setApprovalStatus(id, 'rejected', this.buildActor(req));
  }

  @Patch(':id/photo')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  updatePhoto(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateRecipePhotoDto,
  ) {
    return this.recipes.setImageUrl(id, dto.imageUrl, this.buildActor(req));
  }

  @Delete(':id/photo')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  removePhoto(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recipes.clearImageUrl(id, this.buildActor(req));
  }

  @Post('import')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadDir = join(process.cwd(), 'uploads');
          fs.mkdir(uploadDir, { recursive: true })
            .then(() => cb(null, uploadDir))
            .catch((error) => cb(error, uploadDir));
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname);
          const safeExt = ext || '.xlsx';
          const filename = `${randomUUID()}${safeExt}`;
          cb(null, filename);
        },
      }),
      fileFilter: (
        _req: Request,
        file: { originalname: string; mimetype: string },
        cb,
      ) => {
        const ext = extname(file.originalname || '').toLowerCase();
        const isValidExt = RECIPE_IMPORT_EXTENSIONS.has(ext);
        const mime = (file.mimetype || '').toLowerCase();
        const isValidMime = RECIPE_IMPORT_MIME_TYPES.has(mime);
        if (!isValidExt || !isValidMime) {
          cb(
            new BadRequestException('Only .xlsx or .xls files are allowed'),
            false,
          );
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importRecipes(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: { path: string; originalname: string },
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    try {
      const insertedCount = await this.importFromExcel(
        file.path,
        this.buildActor(req),
      );
      return { insertedCount };
    } finally {
      await fs.unlink(file.path).catch(() => null);
    }
  }

  private async importFromExcel(
    filePath: string,
    actor: {
      id?: string;
      name?: string;
      email?: string;
      site?: string;
    },
  ) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('Sheet tidak ditemukan.');

    const headerValues = worksheet.getRow(1).values as unknown[];
    const headerMap = this.buildHeaderMap(headerValues);
    if (!headerMap.name || !headerMap.category) {
      throw new BadRequestException(
        'Header harus berisi name dan category untuk import recipe.',
      );
    }

    const rows: CreateRecipeDto[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values as unknown[];
      const name = this.getCellValue(values, headerMap.name);
      const category = this.getCellValue(values, headerMap.category);
      if (!name || !category) return;

      const description = headerMap.description
        ? this.getCellValue(values, headerMap.description)
        : '';
      const priceRaw = headerMap.price
        ? this.getCellValue(values, headerMap.price)
        : '';
      const portionRaw = headerMap.portionSize
        ? this.getCellValue(values, headerMap.portionSize)
        : '';
      const statusRaw = headerMap.status
        ? this.getCellValue(values, headerMap.status)
        : '';

      const price = Number(priceRaw);
      const portionSize = Number(portionRaw);
      const status = this.normalizeStatus(statusRaw);

      rows.push({
        name,
        category,
        description: description || undefined,
        price: Number.isFinite(price) && price >= 0 ? price : 0,
        portionSize:
          Number.isFinite(portionSize) && portionSize >= 1 ? portionSize : 1,
        status,
        ingredients: [],
      });
    });

    if (!rows.length) return 0;
    const created = await this.recipes.bulkCreate(rows, actor);
    return created.length;
  }

  private buildHeaderMap(values: unknown[]) {
    const map: Record<string, number> = {};
    for (let idx = 1; idx < values.length; idx += 1) {
      const header = this.normalizeHeader(values[idx]);
      if (!header) continue;
      for (const [key, aliases] of Object.entries(RECIPE_HEADER_ALIASES)) {
        if (aliases.includes(header)) {
          map[key] = idx;
        }
      }
    }
    return map;
  }

  private getCellValue(values: unknown[], index?: number) {
    if (!index) return '';
    const cell = values[index];
    if (cell === undefined || cell === null) return '';
    if (typeof cell === 'object' && cell && 'text' in cell) {
      return String((cell as { text?: unknown }).text ?? '').trim();
    }
    return String(cell).trim();
  }

  private normalizeHeader(value: unknown) {
    return String(value ?? '')
      .trim()
      .toLowerCase();
  }

  private normalizeStatus(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'active' || normalized === 'aktif') return 'active';
    return 'draft';
  }

  private buildActor(req: AuthenticatedRequest) {
    return {
      id: req.user.sub,
      name: req.user.name,
      email: req.user.email,
      site: req.user.site,
    };
  }
}
