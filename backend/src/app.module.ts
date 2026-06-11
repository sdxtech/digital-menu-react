import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { SuperadminModule } from './superadmin/superadmin.module';
import { UnitOfMeasuresModule } from './unit-of-measures/unit-of-measures.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FilesModule } from './files/files.module';
import { ImportsModule } from './imports/imports.module';
import { ExportsModule } from './exports/exports.module';
import { MailModule } from './mail/mail.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { RawMaterialsModule } from './raw-materials/raw-materials.module';
import { RecipesModule } from './recipes/recipes.module';
import { MenuProductionsModule } from './menu-productions/menu-productions.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { SitesModule } from './sites/sites.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URI'),
      }),
    }),
    RedisModule,
    QueueModule,
    UsersModule,
    AuthModule,
    ProductsModule,
    RawMaterialsModule,
    CategoriesModule,
    RecipesModule,
    MenuProductionsModule,
    SitesModule,
    NotificationsModule,
    FilesModule,
    ImportsModule,
    ExportsModule,
    MailModule,
    DashboardModule,
    SuperadminModule,
    UnitOfMeasuresModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
