import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RawMaterialsController } from './raw-materials.controller';
import { RawMaterialsService } from './raw-materials.service';
import { RawMaterial, RawMaterialSchema } from './schemas/raw-material.schema';
import {
  RawMaterialVendorPrice,
  RawMaterialVendorPriceSchema,
} from './schemas/raw-material-vendor-price.schema';
import { AuthModule } from '../auth/auth.module';
import { Recipe, RecipeSchema } from '../recipes/schemas/recipe.schema';
import { SitesModule } from '../sites/sites.module';
import { NotificationsModule } from '../notifications/notifications.module'; // Adjust path if needed

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RawMaterial.name, schema: RawMaterialSchema },
      {
        name: RawMaterialVendorPrice.name,
        schema: RawMaterialVendorPriceSchema,
      },
      { name: Recipe.name, schema: RecipeSchema },
    ]),
    NotificationsModule,
    AuthModule,
    SitesModule,
  ],
  providers: [RawMaterialsService],
  controllers: [RawMaterialsController],
  exports: [RawMaterialsService],
})
export class RawMaterialsModule {}
