import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { MenuProductionsModule } from '../menu-productions/menu-productions.module';
import {
  MenuProduction,
  MenuProductionSchema,
} from '../menu-productions/schemas/menu-production.schema';
import { Recipe, RecipeSchema } from '../recipes/schemas/recipe.schema';
import { Site, SiteSchema } from '../sites/schemas/site.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import {
  DashboardAccess,
  DashboardAccessSchema,
} from './schemas/dashboard-access.schema';
import { DashboardAccessController } from './dashboard-access.controller';
import { DashboardAccessService } from './dashboard-access.service';

@Module({
  imports: [
    AuthModule,
    MenuProductionsModule,
    MongooseModule.forFeature([
      { name: MenuProduction.name, schema: MenuProductionSchema },
      { name: User.name, schema: UserSchema },
      { name: Site.name, schema: SiteSchema },
      { name: Recipe.name, schema: RecipeSchema },
      { name: Client.name, schema: ClientSchema },
      { name: DashboardAccess.name, schema: DashboardAccessSchema },
    ]),
  ],
  controllers: [DashboardController, DashboardAccessController],
  providers: [DashboardService, DashboardAccessService],
})
export class DashboardModule {}
