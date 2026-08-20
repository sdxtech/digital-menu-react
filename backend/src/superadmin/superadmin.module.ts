import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { MenuProductionsModule } from '../menu-productions/menu-productions.module';
import { SitesModule } from '../sites/sites.module';
import { UsersModule } from '../users/users.module';
import { SuperadminController } from './superadmin.controller';
import { SuperadminSitesController } from './superadmin-sites.controller';
import { SuperadminUsersController } from './superadmin-users.controller';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [
    AuthModule,
    MailModule,
    MenuProductionsModule,
    SitesModule,
    UsersModule,
    ClientsModule,
  ],
  controllers: [
    SuperadminController,
    SuperadminSitesController,
    SuperadminUsersController,
  ],
})
export class SuperadminModule {}
