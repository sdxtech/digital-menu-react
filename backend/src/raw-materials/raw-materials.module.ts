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
    AuthModule,
  ],
  providers: [RawMaterialsService],
  controllers: [RawMaterialsController],
  exports: [RawMaterialsService],
})
export class RawMaterialsModule {}
