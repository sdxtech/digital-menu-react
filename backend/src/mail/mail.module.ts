import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailProcessor } from './processors/mail.processor';
import { QueueModule } from '../queue/queue.module';
import { UsersModule } from '../users/users.module';
import { WorkflowMailService } from './workflow-mail.service';
import { HostingerMailClient } from './hostinger-mail.client';

@Module({
  imports: [QueueModule, UsersModule],
  providers: [
    MailService,
    MailProcessor,
    HostingerMailClient,
    WorkflowMailService,
  ],
  exports: [MailService, WorkflowMailService],
})
export class MailModule {}
