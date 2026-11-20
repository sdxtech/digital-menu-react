import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { RawMaterialsModule } from '../raw-materials/raw-materials.module';
import { UnitOfMeasuresModule } from '../unit-of-measures/unit-of-measures.module';
import { Site, SiteSchema } from '../sites/schemas/site.schema';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import {
  InventoryEntry,
  InventoryEntrySchema,
  InventoryOpeningPreview,
  InventoryOpeningPreviewSchema,
  InventoryIssue,
  InventoryIssueSchema,
  InventoryState,
  InventoryStateSchema,
} from './inventory.schema';

@Module({
  imports: [
    AuthModule,
    RawMaterialsModule,
    UnitOfMeasuresModule,
    MongooseModule.forFeature([
      { name: Site.name, schema: SiteSchema },
      { name: InventoryState.name, schema: InventoryStateSchema },
      { name: InventoryEntry.name, schema: InventoryEntrySchema },
      {
        name: InventoryOpeningPreview.name,
        schema: InventoryOpeningPreviewSchema,
      },
      { name: InventoryIssue.name, schema: InventoryIssueSchema },
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
