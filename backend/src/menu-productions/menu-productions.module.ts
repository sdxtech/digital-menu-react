import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  MenuProduction,
  MenuProductionSchema,
} from './schemas/menu-production.schema';
import { MenuProductionsController } from './menu-productions.controller';
import { MenuProductionsService } from './menu-productions.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MenuProduction.name, schema: MenuProductionSchema },
    ]),
    AuthModule,
  ],
  controllers: [MenuProductionsController],
  providers: [MenuProductionsService],
  exports: [MenuProductionsService],
})
export class MenuProductionsModule {}
