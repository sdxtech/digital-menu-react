import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';

@Module({
  imports: [AuthModule, MailModule, UsersModule],
  controllers: [AdminController, AdminUsersController],
})
export class AdminModule {}
