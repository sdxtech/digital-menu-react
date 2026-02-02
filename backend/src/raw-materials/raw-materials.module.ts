import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RawMaterialsController } from './raw-materials.controller';
import { RawMaterialsService } from './raw-materials.service';
import { RawMaterial, RawMaterialSchema } from './schemas/raw-material.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RawMaterial.name, schema: RawMaterialSchema },
    ]),
    AuthModule,
  ],
  providers: [RawMaterialsService],
  controllers: [RawMaterialsController],
  exports: [RawMaterialsService],
})
export class RawMaterialsModule {}
