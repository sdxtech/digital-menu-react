import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportsProcessor } from './processors/imports.processor';
import { FilesModule } from '../files/files.module';
import { ProductsModule } from '../products/products.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { RawMaterialsModule } from '../raw-materials/raw-materials.module';

@Module({
  imports: [
    QueueModule,
    FilesModule,
    ProductsModule,
    RawMaterialsModule,
    CategoriesModule,
    NotificationsModule,
    AuthModule,
  ],
  controllers: [ImportsController],
  providers: [ImportsService, ImportsProcessor],
})
export class ImportsModule {}
