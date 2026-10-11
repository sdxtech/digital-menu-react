import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportsProcessor } from './processors/exports.processor';
import { ProductsModule } from '../products/products.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import { AuthModule } from '../auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Recipe, RecipeSchema } from '../recipes/schemas/recipe.schema';
import { UsersModule } from '../users/users.module';
import { RecipeExportsService } from './recipe-exports.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Recipe.name, schema: RecipeSchema }]),
    UsersModule,
    QueueModule,
    ProductsModule,
    FilesModule,
    NotificationsModule,
    AuthModule,
  ],
  controllers: [ExportsController],
  providers: [ExportsService, ExportsProcessor, RecipeExportsService],
})
export class ExportsModule {}
