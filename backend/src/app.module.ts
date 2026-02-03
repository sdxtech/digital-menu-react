import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FilesModule } from './files/files.module';
import { ImportsModule } from './imports/imports.module';
import { ExportsModule } from './exports/exports.module';
import { MailModule } from './mail/mail.module';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { RawMaterialsModule } from './raw-materials/raw-materials.module';
import { RecipesModule } from './recipes/recipes.module';
import { MenuProductionsModule } from './menu-productions/menu-productions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_URI'),
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
    NotificationsModule,
    FilesModule,
    ImportsModule,
    ExportsModule,
    MailModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
