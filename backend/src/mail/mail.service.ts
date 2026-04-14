import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { MAIL_QUEUE } from '../queue/queue.constants';

type MailJob = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from: string;
};

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_QUEUE) private readonly mailQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  async enqueue(to: string, subject: string, text?: string, html?: string) {
    const from = this.config.getOrThrow<string>('EMAIL_FROM');
    const job = await this.mailQueue.add(
      'send',
      { to, subject, text, html, from } as MailJob,
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    return { jobId: job.id };
  }
}
