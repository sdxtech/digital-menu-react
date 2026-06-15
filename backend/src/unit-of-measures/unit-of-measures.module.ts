import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UnitConversion,
  UnitConversionSchema,
} from './schemas/unit-conversion.schema';
import {
  UnitOfMeasure,
  UnitOfMeasureSchema,
} from './schemas/unit-of-measure.schema';
import {
  RawMaterial,
  RawMaterialSchema,
} from '../raw-materials/schemas/raw-material.schema';
import { UnitOfMeasuresController } from './unit-of-measures.controller';
import { UnitOfMeasuresService } from './unit-of-measures.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UnitOfMeasure.name, schema: UnitOfMeasureSchema },
      { name: UnitConversion.name, schema: UnitConversionSchema },
      { name: RawMaterial.name, schema: RawMaterialSchema },
    ]),
  ],
  controllers: [UnitOfMeasuresController],
  providers: [UnitOfMeasuresService],
  exports: [UnitOfMeasuresService],
})
export class UnitOfMeasuresModule {}
