import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { IMPORTS_QUEUE } from '../queue/queue.constants';

@Injectable()
export class ImportsService {
  constructor(@Inject(IMPORTS_QUEUE) private readonly importsQueue: Queue) {}

  async enqueueProducts(userId: string, fileKey: string) {
    const job = await this.importsQueue.add(
      'import-products',
      { userId, fileKey },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    return { jobId: job.id };
  }
}
