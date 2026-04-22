import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  MenuProduction,
  MenuProductionSchema,
} from '../menu-productions/schemas/menu-production.schema';
import { Recipe, RecipeSchema } from '../recipes/schemas/recipe.schema';
import { Site, SiteSchema } from '../sites/schemas/site.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: MenuProduction.name, schema: MenuProductionSchema },
      { name: User.name, schema: UserSchema },
      { name: Site.name, schema: SiteSchema },
      { name: Recipe.name, schema: RecipeSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
