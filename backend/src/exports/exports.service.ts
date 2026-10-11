import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { EXPORTS_QUEUE } from '../queue/queue.constants';
import { ExportRecipesDto } from './dto/export-recipes.dto';
import {
  RecipeExportsService,
  type RecipeExportJob,
  type RecipeExportResult,
  type RecipeExportScope,
} from './recipe-exports.service';

@Injectable()
export class ExportsService {
  constructor(
    @Inject(EXPORTS_QUEUE) private readonly exportsQueue: Queue,
    private readonly recipeExports: RecipeExportsService,
  ) {}

  async enqueueRecipes(
    userId: string,
    input: ExportRecipesDto,
    scope?: RecipeExportScope,
  ) {
    if (input.mode === 'selected' && !input.ids?.length) {
      throw new BadRequestException('Select at least one recipe to export.');
    }
    if (input.mode === 'all' && input.ids !== undefined) {
      throw new BadRequestException(
        'Export All must not include selected recipe IDs.',
      );
    }
    if (input.mode === 'selected' && input.excludedIds !== undefined) {
      throw new BadRequestException(
        'Selected recipe exports must not include excluded recipe IDs.',
      );
    }
    const ids = input.mode === 'selected' ? [...new Set(input.ids)] : undefined;
    const excludedIds = input.excludedIds
      ? [...new Set(input.excludedIds)]
      : undefined;
    const requestedAt = new Date().toISOString();
    const total = await this.recipeExports.count(
      ids,
      requestedAt,
      excludedIds,
      scope,
    );
    if (!total)
      throw new BadRequestException('No recipes are available to export.');
    if (ids && total !== ids.length) {
      throw new BadRequestException(
        'Some selected recipes are no longer available. Refresh the list and select them again.',
      );
    }
    const job = await this.exportsQueue.add(
      'export-recipes',
      { userId, ids, excludedIds, requestedAt, total, scope },
      {
        attempts: 1,
        removeOnComplete: { age: 86400, count: 100 },
        removeOnFail: { age: 86400, count: 100 },
      },
    );
    return { jobId: job.id, total };
  }

  async recipeCount(input: ExportRecipesDto, scope?: RecipeExportScope) {
    if (input.mode !== 'all' || input.ids !== undefined) {
      throw new BadRequestException('Recipe counts require select-all mode.');
    }
    const excludedIds = input.excludedIds
      ? [...new Set(input.excludedIds)]
      : undefined;
    const total = await this.recipeExports.count(
      undefined,
      new Date().toISOString(),
      excludedIds,
      scope,
    );
    return { total };
  }

  async recipeStatus(userId: string, jobId: string) {
    const job = await this.ownedRecipeJob(userId, jobId);
    const state = await job.getState();
    const status =
      state === 'completed' || state === 'failed'
        ? state
        : state === 'active'
          ? 'processing'
          : 'waiting';
    const result = job.returnvalue;
    return {
      jobId,
      status,
      total: job.data.total,
      completed: typeof job.progress === 'number' ? job.progress : 0,
      ...(status === 'completed'
        ? { count: result.count, filename: result.filename }
        : {}),
      ...(status === 'failed'
        ? {
            error:
              job.failedReason || 'Recipe export failed. Please try again.',
          }
        : {}),
    };
  }

  async recipeDownload(userId: string, jobId: string) {
    const job = await this.ownedRecipeJob(userId, jobId);
    if ((await job.getState()) !== 'completed') {
      throw new ConflictException('The export is not ready to download.');
    }
    return this.recipeExports.downloadFile(job.returnvalue);
  }

  private async ownedRecipeJob(
    userId: string,
    jobId: string,
  ): Promise<Job<RecipeExportJob, RecipeExportResult>> {
    const job = (await this.exportsQueue.getJob(jobId)) as
      | Job<RecipeExportJob, RecipeExportResult>
      | undefined;
    if (!job || job.name !== 'export-recipes' || job.data.userId !== userId) {
      throw new NotFoundException(
        'Recipe export not found or expired. Please start a new export.',
      );
    }
    return job;
  }

  async enqueueProducts(userId: string, site?: string) {
    const job = await this.exportsQueue.add(
      'export-products',
      { userId, site },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    return { jobId: job.id };
  }
}
