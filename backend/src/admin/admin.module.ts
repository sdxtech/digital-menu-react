import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [AdminController],
})
export class AdminModule {}
