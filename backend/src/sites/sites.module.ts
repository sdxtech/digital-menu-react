import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Site, SiteSchema } from './schemas/site.schema';
import { SitesService } from './sites.service';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Site.name, schema: SiteSchema }, { name: User.name, schema: UserSchema }]),
  ],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
