import {
  Body,
  BadRequestException,
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
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { extname } from 'path';
import { promises as fs } from 'fs';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { getUploadDir } from '../common/upload-dir';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { BulkUpdateSpecificConversionsDto } from './dto/bulk-update-specific-conversions.dto';
import { ListRawMaterialsQueryDto } from './dto/list-raw-materials.query.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { RawMaterialsService } from './raw-materials.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';

const PRICE_UPDATE_EXTENSIONS = new Set(['.xlsx', '.csv']);
const PRICE_UPDATE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
  'application/octet-stream',
]);

type UploadFilterCallback = (error: Error | null, acceptFile: boolean) => void;
type PriceUpdateRow = {
  productCode: string;
  price: number;
  rowNumber?: number;
};

@Controller('raw-materials')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RawMaterialsController {
  constructor(
    private readonly rawMaterials: RawMaterialsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Post()
  @Roles(AppRole.Chef, AppRole.Superadmin)
  async create(
    @Body() dto: CreateRawMaterialDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const newMaterial = await this.rawMaterials.create({
      productCode: dto.productCode,
      name: dto.name,
      unitOfMeasures: dto.unitOfMeasures,
      baseUnitOfMeasures: dto.baseUnitOfMeasures,
      conversionFactor: dto.conversionFactor,
      vendor: dto.vendor,
      currency: dto.currency,
      minimumQuantity: dto.minimumQuantity,
      price: dto.price,
    });

    //  PASTE THIS EXACTLY IN ITS PLACE:
    try {
      const actorId = req.user.sub;
      const targetSite = req.user?.site || 'global';

      await this.notificationsService.createHierarchicalNotification(
        actorId, // 1. Actor ID
        'New Raw Material Added', // 2. Title
        `New material: ${newMaterial.name} (${newMaterial.productCode})`, // 3. Message
        targetSite,
        'chef', // 5. Target User Role 🌟 Set to chef so your badge lights up!
        'RAW_MATERIAL_DATA_BANK', // 6. Component Key
        {
          productCode: newMaterial.productCode,
          id: newMaterial._id?.toString() || newMaterial.id?.toString(),
        }, // 7. Payload Object
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Raw material notification dispatch failed: ${message}`);
    }

    return newMaterial;
  }

  @Get()
  @Roles(
    AppRole.Chef,
    AppRole.Superadmin,
    AppRole.UnitManager,
    AppRole.Storekeeper,
  )
  list(@Query() query: ListRawMaterialsQueryDto) {
    return this.rawMaterials.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
    });
  }

  @Get('unit-options')
  @Roles(AppRole.Superadmin)
  listRawMaterialUnitOptions() {
    return this.rawMaterials.findUnitOfMeasuresOptions();
  }

  @Get(':productCode/vendor-prices')
  @Roles(
    AppRole.Chef,
    AppRole.Superadmin,
    AppRole.UnitManager,
    AppRole.Storekeeper,
  )
  listVendorPrices(
    @Param('productCode') productCode: string,
    @Query('site') site?: string,
    @Query('vendor') vendor?: string,
  ) {
    return this.rawMaterials.findVendorPrices({ productCode, site, vendor });
  }

  @Post('prices/upload')
  @Roles(AppRole.Superadmin)
  @UseInterceptors(
    FileInterceptor('file', {
      dest: getUploadDir(),
      fileFilter: (
        _req: Request,
        file: { originalname: string; mimetype: string },
        cb: UploadFilterCallback,
      ) => {
        const ext = extname(file.originalname || '').toLowerCase();
        const isValidExt = PRICE_UPDATE_EXTENSIONS.has(ext);
        const mime = (file.mimetype || '').toLowerCase();
        const isValidMime = PRICE_UPDATE_MIME_TYPES.has(mime);
        if (!isValidExt || !isValidMime) {
          cb(
            new BadRequestException('Only .xlsx or .csv files are allowed'),
            false,
          );
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadPriceUpdates(
    @UploadedFile()
    file?: {
      path: string;
      originalname: string;
      mimetype: string;
    },
  ) {
    if (!file) throw new BadRequestException('file is required');

    try {
      const rows = await this.parsePriceUpdateFile(
        file.path,
        file.originalname,
      );
      if (rows.length === 0) {
        throw new BadRequestException(
          'File must include at least one row with product code and price.',
        );
      }
      return this.rawMaterials.bulkUpdatePricesByProductCode(rows);
    } finally {
      await fs.unlink(file.path).catch(() => undefined);
    }
  }

  @Patch('specific-conversions/bulk')
  @Roles(AppRole.Superadmin)
  bulkUpdateSpecificConversions(@Body() dto: BulkUpdateSpecificConversionsDto) {
    return this.rawMaterials.bulkUpdateSpecificConversions({
      search: dto.search,
      unitOfMeasures: dto.unitOfMeasures,
      baseUnitOfMeasures: dto.baseUnitOfMeasures,
      conversionFactor: dto.conversionFactor,
    });
  }

  @Patch(':id')
  @Roles(AppRole.Chef, AppRole.Superadmin)
  update(@Param('id') id: string, @Body() dto: UpdateRawMaterialDto) {
    return this.rawMaterials.updateById(id, {
      productCode: dto.productCode,
      name: dto.name,
      unitOfMeasures: dto.unitOfMeasures,
      baseUnitOfMeasures: dto.baseUnitOfMeasures,
      conversionFactor: dto.conversionFactor,
      vendor: dto.vendor,
      currency: dto.currency,
      minimumQuantity: dto.minimumQuantity,
      price: dto.price,
    });
  }

  @Delete(':id')
  @Roles(AppRole.Superadmin)
  remove(@Param('id') id: string) {
    return this.rawMaterials.deleteById(id);
  }

  private async parsePriceUpdateFile(filePath: string, fileName: string) {
    const ext = extname(fileName || '').toLowerCase();
    if (ext === '.csv') return this.parsePriceCsv(filePath);
    return this.parsePriceWorkbook(filePath);
  }

  private async parsePriceWorkbook(
    filePath: string,
  ): Promise<PriceUpdateRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('Worksheet not found.');

    const header = this.buildPriceHeaderMap(
      (worksheet.getRow(1).values as unknown as unknown[]).slice(1),
    );
    const rows: PriceUpdateRow[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values as unknown as unknown[];
      const productCode = this.cellToText(values[header.productCode + 1]);
      const price = this.parsePriceValue(values[header.price + 1]);
      if (!productCode && price === undefined) return;
      if (!productCode || price === undefined) {
        throw new BadRequestException(
          `Invalid price update row ${rowNumber}. Product code and price are required.`,
        );
      }
      rows.push({ productCode, price, rowNumber });
    });

    return rows;
  }

  private async parsePriceCsv(filePath: string): Promise<PriceUpdateRow[]> {
    const content = await fs.readFile(filePath, 'utf8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as unknown as Record<string, unknown>[];
    const rows: PriceUpdateRow[] = [];

    records.forEach((record, index) => {
      const normalized: Record<string, unknown> = Object.fromEntries(
        Object.entries(record).map(([key, value]) => [
          this.normalizeHeader(key),
          value,
        ]),
      );
      const productCode = this.cellToText(
        this.pickValue(normalized, [
          'product code',
          'product_code',
          'productcode',
          'code',
          'kode produk',
        ]),
      );
      const price = this.parsePriceValue(
        this.pickValue(normalized, ['price', 'prices', 'harga']),
      );
      if (!productCode && price === undefined) return;
      if (!productCode || price === undefined) {
        throw new BadRequestException(
          `Invalid price update row ${index + 2}. Product code and price are required.`,
        );
      }
      rows.push({ productCode, price, rowNumber: index + 2 });
    });

    return rows;
  }

  private buildPriceHeaderMap(values: unknown[]) {
    const normalizedHeaders = values.map((value) =>
      this.normalizeHeader(this.cellToText(value)),
    );
    const productCode = this.findHeaderIndex(normalizedHeaders, [
      'product code',
      'product_code',
      'productcode',
      'code',
      'kode produk',
    ]);
    const price = this.findHeaderIndex(normalizedHeaders, [
      'price',
      'prices',
      'harga',
    ]);

    if (productCode === -1 || price === -1) {
      throw new BadRequestException(
        'Header must include product code and price.',
      );
    }

    return { productCode, price };
  }

  private findHeaderIndex(headers: string[], aliases: string[]) {
    return headers.findIndex((header) => aliases.includes(header));
  }

  private pickValue(record: Record<string, unknown>, aliases: string[]) {
    for (const alias of aliases) {
      const value = record[alias];
      if (this.cellToText(value)) {
        return value;
      }
    }
    return undefined;
  }

  private normalizeHeader(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private cellToText(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (this.isRecord(value)) {
      if ('text' in value) return this.cellToText(value.text).trim();
      if ('result' in value) return this.cellToText(value.result).trim();
    }
    if (typeof value === 'string') return value.trim();
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value).trim();
    }
    if (value instanceof Date) return value.toISOString();
    return '';
  }

  private parsePriceValue(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0 ? value : undefined;
    }

    const text = this.cellToText(value).replace(/[^\d,.-]/g, '');
    if (!text) return undefined;

    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    let normalized = text;

    if (lastComma > -1 && lastDot > -1) {
      const decimalSeparator = lastComma > lastDot ? ',' : '.';
      const thousandSeparator = decimalSeparator === ',' ? '.' : ',';
      normalized = text
        .replace(new RegExp(`\\${thousandSeparator}`, 'g'), '')
        .replace(decimalSeparator, '.');
    } else if (lastComma > -1) {
      normalized = /^\d{1,3}(,\d{3})+$/.test(text)
        ? text.replace(/,/g, '')
        : text.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
      normalized = text.replace(/\./g, '');
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
}
