import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportsProcessor } from './processors/exports.processor';
import { ProductsModule } from '../products/products.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    QueueModule,
    ProductsModule,
    FilesModule,
    NotificationsModule,
    AuthModule,
  ],
  controllers: [ExportsController],
  providers: [ExportsService, ExportsProcessor],
})
export class ExportsModule {}
