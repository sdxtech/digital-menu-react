import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { RawMaterialsModule } from '../raw-materials/raw-materials.module';
import { SitesModule } from '../sites/sites.module';
import { UnitOfMeasuresModule } from '../unit-of-measures/unit-of-measures.module';
import { UsersModule } from '../users/users.module';
import {
  RecipeCodeCounter,
  RecipeCodeCounterSchema,
} from './schemas/recipe-code-counter.schema';
import { Recipe, RecipeSchema } from './schemas/recipe.schema';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';
import { NotificationsModule } from '../notifications/notifications.module'; // 🌟 ADDED IMPORT
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Recipe.name, schema: RecipeSchema },
      { name: RecipeCodeCounter.name, schema: RecipeCodeCounterSchema },
    ]),
    AuthModule,
    UsersModule,
    RawMaterialsModule,
    SitesModule,
    UnitOfMeasuresModule,
    NotificationsModule, // 🌟 ADDED THIS LINE to bridge the dependency gap
    MailModule,
  ],
  controllers: [RecipesController],
  providers: [RecipesService],
  exports: [RecipesService],
})
export class RecipesModule {}
