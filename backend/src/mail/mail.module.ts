import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailProcessor } from './processors/mail.processor';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [MailService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
