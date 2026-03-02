import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { MenuProductionsModule } from '../menu-productions/menu-productions.module';
import { UsersModule } from '../users/users.module';
import { SuperadminController } from './superadmin.controller';
import { SuperadminUsersController } from './superadmin-users.controller';

@Module({
  imports: [AuthModule, MailModule, MenuProductionsModule, UsersModule],
  controllers: [SuperadminController, SuperadminUsersController],
})
export class SuperadminModule {}
