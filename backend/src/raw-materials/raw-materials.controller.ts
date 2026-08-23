import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
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
import { extname } from 'path';
import { promises as fs } from 'fs';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import { getUserSiteScope } from '../auth/site-scope';
import { getUploadDir } from '../common/upload-dir';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { BulkUpdateSpecificConversionsDto } from './dto/bulk-update-specific-conversions.dto';
import { ListRawMaterialsQueryDto } from './dto/list-raw-materials.query.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { RawMaterialsService } from './raw-materials.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { RawMaterialPriceFileParser } from './raw-material-price-file.parser';

const PRICE_UPDATE_EXTENSIONS = new Set(['.xlsx', '.csv']);
const PRICE_UPDATE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
  'application/octet-stream',
]);

type UploadFilterCallback = (error: Error | null, acceptFile: boolean) => void;

@Controller('raw-materials')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RawMaterialsController {
  private readonly priceFileParser = new RawMaterialPriceFileParser();

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
      specificConversions: dto.specificConversions,
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
    AppRole.CorporateChef,
    AppRole.Superadmin,
    AppRole.UnitManager,
    AppRole.Storekeeper,
  )
  list(
    @Query() query: ListRawMaterialsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const site = this.resolveRawMaterialSite(req, query.site);
    return this.rawMaterials.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      search: query.search,
      site,
    });
  }

  @Get('unit-options')
  @Roles(AppRole.Chef, AppRole.CorporateChef, AppRole.Superadmin)
  listRawMaterialUnitOptions() {
    return this.rawMaterials.findUnitOfMeasuresOptions();
  }

  @Get(':productCode/vendor-prices')
  @Roles(
    AppRole.Chef,
    AppRole.CorporateChef,
    AppRole.Superadmin,
    AppRole.UnitManager,
    AppRole.Storekeeper,
  )
  listVendorPrices(
    @Req() req: AuthenticatedRequest,
    @Param('productCode') productCode: string,
    @Query('site') site?: string,
    @Query('vendor') vendor?: string,
  ) {
    const resolvedSite = this.resolveRawMaterialSite(req, site);
    return this.rawMaterials.findVendorPrices({
      productCode,
      site: resolvedSite,
      vendor,
    });
  }

  private resolveRawMaterialSite(
    req: AuthenticatedRequest,
    requestedSite?: string,
  ) {
    if (req.user.roles?.includes(AppRole.CorporateChef)) {
      const requested = requestedSite?.trim();
      const assignedSites = Array.from(
        new Set([req.user.site, ...(req.user.sites ?? [])]),
      )
        .map((site) => site?.trim())
        .filter((site): site is string => Boolean(site));
      const resolvedSite = requested
        ? assignedSites.find(
            (site) => site.toLowerCase() === requested.toLowerCase(),
          )
        : req.user.site?.trim();
      if (!resolvedSite) {
        throw new ForbiddenException(
          'The selected site is not assigned to this Corporate Chef.',
        );
      }
      return resolvedSite;
    }
    return getUserSiteScope(req.user) ?? requestedSite;
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
      const rows = this.priceFileParser.parse(file.path, file.originalname);
      const result =
        await this.rawMaterials.bulkUpdatePricesByProductCode(rows);
      if (result.requestedCount === 0) {
        throw new BadRequestException(
          'File must include at least one row with product code and price.',
        );
      }
      return result;
    } finally {
      await fs.unlink(file.path).catch(() => undefined);
    }
  }

  @Patch('specific-conversions/bulk')
  @Roles(AppRole.Superadmin)
  bulkUpdateSpecificConversions(@Body() dto: BulkUpdateSpecificConversionsDto) {
    return this.rawMaterials.bulkUpdateSpecificConversions({
      rawMaterialIds: dto.rawMaterialIds,
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
      ...(dto.specificConversions !== undefined
        ? { specificConversions: dto.specificConversions }
        : {}),
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
}
