import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { MAIL_QUEUE } from '../queue/queue.constants';
import type { EnqueueMailInput, MailJob } from './mail.types';

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_QUEUE) private readonly mailQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  async enqueue(input: EnqueueMailInput) {
    const from = this.config.getOrThrow<string>('EMAIL_FROM');
    const overrideTo = this.config
      .get<string>('EMAIL_RECIPIENT_OVERRIDE')
      ?.trim();
    const to = overrideTo || input.to.trim().toLowerCase();
    const jobId = input.deduplicationKey
      ? `mail-${createHash('sha256').update(input.deduplicationKey).digest('hex')}`
      : undefined;
    const job = await this.mailQueue.add(
      'send',
      {
        to,
        ...(overrideTo ? { originalTo: input.to.trim().toLowerCase() } : {}),
        subject: input.subject,
        text: input.text,
        html: input.html,
        from,
        category: input.category,
      } satisfies MailJob,
      {
        ...(jobId ? { jobId } : {}),
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
      },
    );

    return { jobId: job.id };
  }
}
