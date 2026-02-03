import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { IMPORTS_QUEUE } from '../queue/queue.constants';

@Injectable()
export class ImportsService {
  constructor(@Inject(IMPORTS_QUEUE) private readonly importsQueue: Queue) {}

  async enqueueProducts(
    userId: string,
    fileKey: string,
    fileName?: string,
    contentType?: string,
  ) {
    const job = await this.importsQueue.add(
      'import-products',
      { userId, fileKey, fileName, contentType },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    return { jobId: job.id };
  }

  async enqueueRawMaterials(
    userId: string,
    fileKey?: string,
    fileName?: string,
    contentType?: string,
    filePath?: string,
  ) {
    const job = await this.importsQueue.add(
      'import-raw-materials',
      { userId, fileKey, fileName, contentType, filePath },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );

    return { jobId: job.id };
  }
}
