import {
  BadRequestException,
  Body,
  Controller,
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
import { extname, join } from 'path';
import { promises as fs } from 'fs';
import ExcelJS from 'exceljs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { ListRecipesQueryDto } from './dto/list-recipes.query.dto';
import { RecipesService } from './recipes.service';

const RECIPE_HEADER_ALIASES = {
  name: ['name', 'nama', 'menu', 'menu name'],
  category: ['category', 'kategori', 'jenis'],
  description: ['description', 'deskripsi', 'desc'],
  price: ['price', 'harga'],
  status: ['status', 'state'],
  portionSize: ['portion', 'portions', 'porsi', 'serving', 'servings', 'yield'],
};

@Controller('recipes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRecipeDto) {
    return this.recipes.create(dto, req.user.sub);
  }

  // BACKEND LOGIC: provide category options for recipe filters.
  @Get('categories')
  listCategories() {
    return this.recipes.listCategories();
  }

  @Get()
  list(@Query() query: ListRecipesQueryDto) {
    return this.recipes.findAll(query);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.recipes.setApprovalStatus(id, 'approved');
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string) {
    return this.recipes.setApprovalStatus(id, 'rejected');
  }

  @Post('import')
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
          const filename = `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}${safeExt}`;
          cb(null, filename);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
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
      const insertedCount = await this.importFromExcel(file.path, req.user.sub);
      return { insertedCount };
    } finally {
      await fs.unlink(file.path).catch(() => null);
    }
  }

  private async importFromExcel(filePath: string, createdBy: string) {
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
    const created = await this.recipes.bulkCreate(rows, createdBy);
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
    return String(value ?? '').trim().toLowerCase();
  }

  private normalizeStatus(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'active' || normalized === 'aktif') return 'active';
    return 'draft';
  }
}
