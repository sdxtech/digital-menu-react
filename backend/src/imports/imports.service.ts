import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { rm } from 'node:fs/promises';
import { IMPORTS_QUEUE } from '../queue/queue.constants';
import type { RawMaterialImportResult } from './raw-material-import-result.type';

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
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @Inject(IMPORTS_QUEUE)
    private readonly importsQueue: Queue<
      ImportJobData,
      RawMaterialImportResult | undefined
    >,
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

  async getImportJobStatus(userId: string, jobId: string) {
    const job = await this.importsQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Import job was not found.');
    }
    if (job.data.userId !== userId) {
      throw new ForbiddenException('You can only view your own import jobs.');
    }
    if (job.name !== 'import-raw-materials') {
      throw new BadRequestException('This import job cannot be viewed.');
    }

    const state = await job.getState();
    if (state === 'unknown') {
      throw new NotFoundException('Import job was not found.');
    }
    // Reload the result after reading the state: a fast job may finish between
    // getJob() and getState(), leaving the first snapshot without its returnvalue.
    const result =
      state === 'completed'
        ? ((await this.importsQueue.getJob(jobId))?.returnvalue ?? null)
        : null;
    return {
      jobId,
      status:
        state === 'completed' && result?.status === 'cancelled'
          ? ('cancelled' as const)
          : state,
      result,
    };
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
    if (job.data.filePath) {
      try {
        await rm(job.data.filePath, { force: true });
      } catch (error) {
        this.logger.error(
          'Failed to clean cancelled raw material import',
          error,
        );
      }
    }
    return { jobId, status: 'cancelled' };
  }
}
