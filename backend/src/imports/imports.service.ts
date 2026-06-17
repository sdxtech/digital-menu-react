import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { IMPORTS_QUEUE } from '../queue/queue.constants';

type ImportJobData = {
  userId: string;
  fileKey?: string;
  fileName?: string;
  contentType?: string;
  filePath?: string;
  site?: string;
  cancelRequested?: boolean;
  cancelRequestedAt?: string;
};

@Injectable()
export class ImportsService {
  constructor(
    @Inject(IMPORTS_QUEUE) private readonly importsQueue: Queue<ImportJobData>,
  ) {}

  async enqueueProducts(
    userId: string,
    fileKey: string,
    fileName?: string,
    contentType?: string,
    site?: string,
  ) {
    const job = await this.importsQueue.add(
      'import-products',
      { userId, fileKey, fileName, contentType, site },
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

  async cancelImportJob(userId: string, jobId: string) {
    const job = await this.importsQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Import job was not found.');
    }

    if (job.data.userId !== userId) {
      throw new ForbiddenException('You can only cancel your own import jobs.');
    }

    if (job.name !== 'import-raw-materials') {
      throw new BadRequestException('This import job cannot be cancelled.');
    }

    const state = await job.getState();
    if (state === 'completed' || state === 'failed') {
      return { jobId, status: state };
    }

    if (state === 'active') {
      await job.updateData({
        ...job.data,
        cancelRequested: true,
        cancelRequestedAt: new Date().toISOString(),
      });

      return { jobId, status: 'cancel_requested' };
    }

    await job.remove();
    return { jobId, status: 'cancelled' };
  }
}
