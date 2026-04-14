import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { Recipe, RecipeSchema } from '../recipes/schemas/recipe.schema';
import {
  MenuProductionCodeCounter,
  MenuProductionCodeCounterSchema,
} from './schemas/menu-production-code-counter.schema';
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
      {
        name: MenuProductionCodeCounter.name,
        schema: MenuProductionCodeCounterSchema,
      },
      { name: Recipe.name, schema: RecipeSchema },
    ]),
    AuthModule,
    UsersModule,
  ],
  controllers: [MenuProductionsController],
  providers: [MenuProductionsService],
  exports: [MenuProductionsService],
})
export class MenuProductionsModule {}
