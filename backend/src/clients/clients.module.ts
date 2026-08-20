import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SitesModule } from '../sites/sites.module';
import { ClientsController } from './clients.controller';
import { ClientsSiteController } from './clients-site.controller';
import { ClientsService } from './clients.service';
import { Client, ClientSchema } from './schemas/client.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Client.name, schema: ClientSchema }]),
    SitesModule,
  ],
  providers: [ClientsService],
  controllers: [ClientsController, ClientsSiteController],
})
export class ClientsModule {}
