import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';
import { MailService } from '../mail/mail.service';
import { TestEmailDto } from '../mail/dto/test-email.dto';
import { MenuProductionsService } from '../menu-productions/menu-productions.service';
import { ExportStoreRequestsQueryDto } from './dto/export-store-requests.query.dto';

@Controller('superadmin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuperadminController {
  constructor(
    private readonly mail: MailService,
    private readonly menuProductions: MenuProductionsService,
  ) {}

  @Get('ping')
  @Roles(AppRole.Superadmin)
  ping() {
    return { ok: true };
  }

  @Post('test-email')
  @Roles(AppRole.Superadmin)
  testEmail(@Body() dto: TestEmailDto) {
    return this.mail.enqueue(
      dto.to,
      'Test Email',
      'Ini email test dari Digital Menu.',
    );
  }

  @Get('store-requests/sites')
  @Roles(AppRole.Superadmin)
  async listStoreRequestSites() {
    return {
      items: await this.menuProductions.listStoreRequestSites(),
    };
  }

  @Get('store-requests/export')
  @Roles(AppRole.Superadmin)
  async exportStoreRequests(@Query() query: ExportStoreRequestsQueryDto) {
    const selectedSites = Array.from(
      new Set(
        (query.sites ?? query.site ?? '')
          .split(',')
          .map((site) => site.trim())
          .filter(Boolean),
      ),
    );

    const startDate = query.startDate?.trim();
    const endDate = query.endDate?.trim();

    if ((startDate && !endDate) || (!startDate && endDate)) {
      throw new BadRequestException(
        'startDate and endDate must be provided together.',
      );
    }
    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException(
        'startDate must be before or equal to endDate.',
      );
    }

    const requestQuery: {
      startDate?: string;
      endDate?: string;
    } = {};
    if (startDate && endDate) {
      requestQuery.startDate = startDate;
      requestQuery.endDate = endDate;
    }

    const items = selectedSites.length
      ? (
          await Promise.all(
            selectedSites.map(async (site) => {
              const result = await this.menuProductions.buildStoreRequestGroups(
                requestQuery,
                site,
              );
              return (result.items ?? []).map((group) => ({ ...group, site }));
            }),
          )
        )
          .flat()
          .sort((a, b) =>
            a.date === b.date
              ? a.site.localeCompare(b.site)
              : a.date.localeCompare(b.date),
          )
      : (await this.menuProductions.buildStoreRequestGroups(requestQuery)).items ??
        [];

    return { items };
  }
}
