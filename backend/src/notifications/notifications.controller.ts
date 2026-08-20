import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { GetRoleNotificationsDto } from './dto/get-role-notifications.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { canAccessAllSites, getUserSiteScope } from '../auth/site-scope';

@Controller(['notifications', 'api/notifications'])
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('role')
  async getRoleNotifications(
    @Req() req: AuthenticatedRequest,
    @Query() filter: GetRoleNotificationsDto,
  ) {
    return this.notificationsService.getRoleNotifications(
      this.resolveRoleFilter(req, filter),
    );
  }

  @Get('role-unread')
  async getRoleUnread(
    @Req() req: AuthenticatedRequest,
    @Query() filter: GetRoleNotificationsDto,
  ) {
    return this.notificationsService.getUnreadRoleNotifications(
      this.resolveRoleFilter(req, filter),
    );
  }

  @Patch('mark-role-read')
  async markRoleRead(
    @Req() req: AuthenticatedRequest,
    @Body() filter: GetRoleNotificationsDto,
  ) {
    return this.notificationsService.markRoleNotificationsAsRead(
      this.resolveRoleFilter(req, filter),
    );
  }

  @Post('mark-read')
  async markRoleReadLegacy(
    @Req() req: AuthenticatedRequest,
    @Body() filter: GetRoleNotificationsDto,
  ) {
    return this.notificationsService.markRoleNotificationsAsRead(
      this.resolveRoleFilter(req, filter),
    );
  }

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.listByUser(
      req.user.sub,
      Number(page || 1),
      Number(limit || 20),
    );
  }

  @Get('user')
  async listByUser(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.listByUser(
      req.user.sub,
      Number(page || 1),
      Number(limit || 20),
    );
  }

  @Patch(':id/read')
  markRead(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.notificationsService.markRead(req.user.sub, id);
  }

  private resolveRoleFilter(
    req: AuthenticatedRequest,
    filter: GetRoleNotificationsDto,
  ): GetRoleNotificationsDto {
    const siteCode = getUserSiteScope(req.user) ?? filter.siteCode?.trim();
    if (!siteCode) {
      throw new BadRequestException('siteCode is required.');
    }

    const targetUserRole = this.resolveTargetRole(req, filter.targetUserRole);
    return {
      ...filter,
      siteCode,
      targetUserRole,
      componentKey: filter.componentKey?.trim() || undefined,
    };
  }

  private resolveTargetRole(req: AuthenticatedRequest, role?: string) {
    const normalizedRole = this.normalizeRole(role);
    if (!normalizedRole) {
      throw new BadRequestException('targetUserRole is required.');
    }

    if (canAccessAllSites(req.user)) return normalizedRole;

    const userRoles = req.user.roles?.map((item) => this.normalizeRole(item));
    if (!userRoles?.includes(normalizedRole)) {
      throw new ForbiddenException(
        'Cannot access notifications for this role.',
      );
    }

    return normalizedRole;
  }

  private normalizeRole(role?: string) {
    const normalized = role?.trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'unit-manager' || normalized === 'unit.manager') {
      return 'unit.manager';
    }
    if (normalized === 'corporatechef' || normalized === 'corporate.chef') {
      return 'corporate-chef';
    }
    return normalized;
  }
}
