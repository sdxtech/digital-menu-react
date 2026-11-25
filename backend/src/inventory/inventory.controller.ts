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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';
import { getUserSiteScope } from '../auth/site-scope';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import {
  CreateInventoryReceiptDto,
  ConfirmOpeningInventoryDto,
  ConfirmPurchaseOrderDto,
  InventoryDashboardQueryDto,
  InventoryQueryDto,
  OpeningInventoryDto,
  ResetInventoryDto,
  ReverseInventoryReceiptDto,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AppRole.Storekeeper, AppRole.Superadmin)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  private site(req: AuthenticatedRequest, query: InventoryQueryDto) {
    return this.inventory.resolveSite(getUserSiteScope(req.user) ?? query.site);
  }

  private actor(req: AuthenticatedRequest) {
    return { id: req.user.sub, name: req.user.name || req.user.email };
  }

  @Get('status')
  async status(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventory.status(await this.site(req, query));
  }

  @Post('reset')
  @Roles(AppRole.Superadmin)
  async reset(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @Body() input: ResetInventoryDto,
  ) {
    const site = await this.site(req, query);
    if (input.confirmation !== site)
      throw new BadRequestException(
        'Enter the selected site code to reset inventory.',
      );
    return this.inventory.reset(site, this.actor(req));
  }

  @Get('balances')
  async balances(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventory.balances(await this.site(req, query), query);
  }

  @Get('items')
  async items(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventory.itemOptions(
      await this.site(req, query),
      query.search,
    );
  }

  @Get('dashboard')
  @Roles(AppRole.Storekeeper, AppRole.Superadmin, AppRole.UnitManager)
  async dashboard(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryDashboardQueryDto,
  ) {
    return this.inventory.dashboardStock(await this.site(req, query));
  }

  @Get('dashboard/trend')
  @Roles(AppRole.Storekeeper, AppRole.Superadmin, AppRole.UnitManager)
  async dashboardTrend(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryDashboardQueryDto,
  ) {
    return this.inventory.dashboardTrend(await this.site(req, query), query);
  }

  @Get('dashboard/history')
  @Roles(AppRole.Storekeeper, AppRole.Superadmin, AppRole.UnitManager)
  async dashboardHistory(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryDashboardQueryDto,
  ) {
    return this.inventory.dashboardHistory(await this.site(req, query), query);
  }

  @Get('movements')
  async movements(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventory.history(await this.site(req, query), query);
  }

  @Get('receipts')
  async receipts(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventory.history(await this.site(req, query), query, true);
  }

  @Get('receipts/:id')
  async receipt(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @Param('id') id: string,
  ) {
    return this.inventory.receipt(await this.site(req, query), id);
  }

  @Post('receipts')
  async createReceipt(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @Body() input: CreateInventoryReceiptDto,
  ) {
    return this.inventory.createReceipt(
      await this.site(req, query),
      input,
      this.actor(req),
    );
  }

  @Patch('receipts/:id')
  @Roles(AppRole.Superadmin)
  async editReceipt(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @Param('id') id: string,
    @Body() input: CreateInventoryReceiptDto,
  ) {
    return this.inventory.createReceipt(
      await this.site(req, query),
      input,
      this.actor(req),
      id,
    );
  }

  @Post('receipts/po/preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  async previewPurchaseOrders(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
  ) {
    return this.inventory.previewPurchaseOrders(
      await this.site(req, query),
      this.purchaseOrderFile(file),
    );
  }

  @Post('receipts/po/confirm')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1, fieldSize: 160000 },
    }),
  )
  async confirmPurchaseOrders(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @Body() input: ConfirmPurchaseOrderDto,
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
  ) {
    return this.inventory.confirmPurchaseOrders(
      await this.site(req, query),
      this.purchaseOrderFile(file),
      input,
      this.actor(req),
    );
  }

  private purchaseOrderFile(file?: { buffer: Buffer; originalname: string }) {
    if (!file?.buffer || !file.originalname.toLowerCase().endsWith('.xlsx'))
      throw new BadRequestException('Upload an .xlsx purchase order file.');
    return file.buffer;
  }

  @Post('issue-preview')
  async previewIssue(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @Body() input: OpeningInventoryDto,
  ) {
    return this.inventory.previewIssue(
      await this.site(req, query),
      input.lines,
    );
  }

  @Post('receipts/:id/reverse')
  @Roles(AppRole.Superadmin)
  async reverseReceipt(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @Param('id') id: string,
    @Body() input: ReverseInventoryReceiptDto,
  ) {
    return this.inventory.reverseReceipt(
      await this.site(req, query),
      id,
      input.reason,
      this.actor(req),
    );
  }

  @Post('opening/preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  async preview(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
  ) {
    if (!file?.buffer || !file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Upload an .xlsx opening inventory file.');
    }
    return this.inventory.previewOpening(
      await this.site(req, query),
      file.buffer,
      this.actor(req),
      req.user.roles.includes(AppRole.Superadmin),
    );
  }

  @Post('opening/confirm')
  async activate(
    @Req() req: AuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @Body() input: ConfirmOpeningInventoryDto,
  ) {
    return this.inventory.confirmOpening(
      await this.site(req, query),
      input.previewId,
      this.actor(req),
      req.user.roles.includes(AppRole.Superadmin),
    );
  }
}
