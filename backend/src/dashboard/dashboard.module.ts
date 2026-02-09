import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  MenuProduction,
  MenuProductionSchema,
} from '../menu-productions/schemas/menu-production.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: MenuProduction.name, schema: MenuProductionSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
