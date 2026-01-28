import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EXPORTS_QUEUE } from '../queue/queue.constants';

@Injectable()
export class ExportsService {
  constructor(@Inject(EXPORTS_QUEUE) private readonly exportsQueue: Queue) {}

  async enqueueProducts(userId: string) {
    const job = await this.exportsQueue.add(
      'export-products',
      { userId },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    return { jobId: job.id };
  }
}
