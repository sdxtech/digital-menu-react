import { Controller, Get, Patch, Query, Body, UseGuards, Req } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { GetRoleNotificationsDto } from './dto/get-role-notifications.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('role-unread')
  async getRoleUnread(@Query() filter: GetRoleNotificationsDto) {
    return this.notificationsService.getUnreadRoleNotifications(filter);
  }

  @Patch('mark-role-read')
  async markRoleRead(@Body() filter: GetRoleNotificationsDto) {
    return this.notificationsService.markRoleNotificationsAsRead(filter);
  }

  @UseGuards(JwtAuthGuard)
  @Get('user')
  async listByUser(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.notificationsService.listByUser(req.user.id, Number(page || 1), Number(limit || 20));
  }
}