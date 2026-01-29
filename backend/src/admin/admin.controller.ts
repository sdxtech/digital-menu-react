import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppRole } from '../auth/roles.constants';
import { MailService } from '../mail/mail.service';
import { TestEmailDto } from '../mail/dto/test-email.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly mail: MailService) {}

  @Get('ping')
  @Roles(AppRole.Admin)
  ping() {
    return { ok: true };
  }

  @Post('test-email')
  @Roles(AppRole.Admin)
  testEmail(@Body() dto: TestEmailDto) {
    return this.mail.enqueue(dto.to, 'Test Email', 'Ini email test dari Digital Menu.');
  }
}
