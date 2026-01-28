import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { IMPORTS_QUEUE } from '../queue/queue.constants';

@Injectable()
export class ImportsService {
  constructor(@Inject(IMPORTS_QUEUE) private readonly importsQueue: Queue) {}

  async enqueue(userId: string, fileKey: string, kind: 'products' | 'users' | 'categories') {
    if (kind !== 'products') {
      throw new BadRequestException('Import kind not supported yet');
    }

    const job = await this.importsQueue.add(
      'import',
      { userId, fileKey, kind },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    return { jobId: job.id };
  }
}
