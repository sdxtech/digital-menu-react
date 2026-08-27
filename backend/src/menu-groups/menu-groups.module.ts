import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { MenuGroupsController } from './menu-groups.controller';
import { MenuGroupsService } from './menu-groups.service';
import { MenuGroup, MenuGroupSchema } from './schemas/menu-group.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MenuGroup.name, schema: MenuGroupSchema },
    ]),
    AuthModule,
  ],
  controllers: [MenuGroupsController],
  providers: [MenuGroupsService],
})
export class MenuGroupsModule {}
