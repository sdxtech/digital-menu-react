import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppRole } from '../auth/roles.constants';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@Controller('superadmin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AppRole.Superadmin)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: AuditLogQueryDto) {
    return this.audit.list(query);
  }

  @Get('export')
  async export(
    @Query() query: AuditLogQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const { buffer } = await this.audit.exportManual(query, {
      actorId: req.user.sub,
      actorName: req.user.name,
      actorEmail: req.user.email,
      role: req.user.appRole || req.user.roles?.[0],
      site: req.user.site,
      module: 'audit',
      action: 'EXPORT_PDF',
      method: 'GET',
      path: '/superadmin/audit-logs/export',
      success: true,
      statusCode: 200,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-log-${query.startDate}-${query.endDate}.pdf"`,
    );
    res.send(buffer);
  }

  @Get('files/download-url')
  downloadFile(@Query('key') key: string) {
    return this.audit.getUploadDownloadUrl(key);
  }
}
