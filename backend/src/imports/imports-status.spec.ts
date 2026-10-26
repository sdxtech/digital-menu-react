import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportsProcessor } from './processors/imports.processor';
import type { RawMaterialImportResult } from './raw-material-import-result.type';

describe('Raw material import status', () => {
  const result: RawMaterialImportResult = {
    status: 'completed',
    successCount: 0,
    failCount: 1,
    errors: [
      {
        row: 1,
        name: 'Rice',
        reason: 'Product code already exists. Use Update Prices instead.',
      },
    ],
  };

  const setup = (state = 'completed') => {
    const job = {
      name: 'import-raw-materials',
      data: { userId: 'owner', fileKey: 'private-upload' },
      returnvalue: result as RawMaterialImportResult | undefined,
      failedReason: 'Internal database connection details',
      getState: jest.fn().mockResolvedValue(state),
    };
    const queue = { getJob: jest.fn().mockResolvedValue(job) };
    const service = new ImportsService(queue as never);
    return { job, queue, service };
  };

  it('returns the exact completed job result, even before the first status request', async () => {
    const { service } = setup();
    const controller = new ImportsController(service);
    await expect(
      controller.getImportJobStatus(
        { user: { sub: 'owner' } } as never,
        'job-18',
      ),
    ).resolves.toEqual({ jobId: 'job-18', status: 'completed', result });
  });

  it('reloads a result saved while the initial job snapshot was being checked', async () => {
    const { job, queue, service } = setup();
    queue.getJob.mockResolvedValueOnce({ ...job, returnvalue: undefined });
    await expect(
      service.getImportJobStatus('owner', 'job-18'),
    ).resolves.toEqual({
      jobId: 'job-18',
      status: 'completed',
      result,
    });
  });

  it('reports older completed jobs without inventing success or failure counts', async () => {
    const { job, service } = setup();
    job.returnvalue = undefined;
    await expect(
      service.getImportJobStatus('owner', 'legacy'),
    ).resolves.toEqual({
      jobId: 'legacy',
      status: 'completed',
      result: null,
    });
  });

  it.each(['waiting', 'active', 'delayed', 'failed'])(
    'reports %s without exposing job data or internal failure reasons',
    async (state) => {
      const { service } = setup(state);
      await expect(
        service.getImportJobStatus('owner', 'job-18'),
      ).resolves.toEqual({
        jobId: 'job-18',
        status: state,
        result: null,
      });
    },
  );

  it('distinguishes a cancelled worker result from a successful import', async () => {
    const { job, service } = setup();
    job.returnvalue = { ...result, status: 'cancelled' };
    await expect(
      service.getImportJobStatus('owner', 'job-18'),
    ).resolves.toEqual({
      jobId: 'job-18',
      status: 'cancelled',
      result: job.returnvalue,
    });
  });

  it('denies access to another user before reading the status', async () => {
    const { job, service } = setup();
    await expect(
      service.getImportJobStatus('other-user', 'job-18'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(job.getState).not.toHaveBeenCalled();
  });

  it('rejects jobs belonging to another import feature', async () => {
    const { job, service } = setup();
    job.name = 'import-products';
    await expect(
      service.getImportJobStatus('owner', 'job-18'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports missing or removed jobs instead of waiting indefinitely', async () => {
    const { queue, service } = setup('unknown');
    await expect(
      service.getImportJobStatus('owner', 'removed'),
    ).rejects.toBeInstanceOf(NotFoundException);
    queue.getJob.mockResolvedValueOnce(undefined);
    await expect(
      service.getImportJobStatus('owner', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([false, true])(
    'returns a stored summary through the worker entry point (existing code: %s)',
    async (existingCode) => {
      const rawMaterials = {
        findExistingProductCodes: jest
          .fn()
          .mockResolvedValue(new Set(existingCode ? ['rm-001'] : [])),
        bulkUpsertByProductCode: jest.fn().mockResolvedValue(undefined),
        bulkUpsertVendorPrices: jest.fn().mockResolvedValue(undefined),
      };
      const notifications = {
        emitJobProgress: jest.fn(),
        emitJobDone: jest.fn(),
        emitJobFailed: jest.fn(),
        create: jest.fn().mockResolvedValue(undefined),
      };
      const processor = new ImportsProcessor(
        {},
        { getJob: jest.fn().mockResolvedValue(undefined) } as never,
        {
          getObjectStream: jest
            .fn()
            .mockResolvedValue(
              Readable.from(['Product Code,Name,Unit\nRM-001,Rice,KG\n']),
            ),
        } as never,
        {} as never,
        {} as never,
        rawMaterials as never,
        notifications as never,
      );
      const returned = await processor['handle']({
        id: 'job-18',
        name: 'import-raw-materials',
        data: { userId: 'owner', fileKey: 'upload', fileName: 'materials.csv' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as never);
      expect(returned).toEqual(
        existingCode
          ? result
          : { status: 'completed', successCount: 1, failCount: 0, errors: [] },
      );
      if (existingCode) {
        expect(rawMaterials.bulkUpsertByProductCode).not.toHaveBeenCalled();
        expect(rawMaterials.bulkUpsertVendorPrices).not.toHaveBeenCalled();
      }
      const { job, service } = setup();
      job.returnvalue = returned;
      await expect(
        service.getImportJobStatus('owner', 'job-18'),
      ).resolves.toEqual({
        jobId: 'job-18',
        status: 'completed',
        result: returned,
      });
    },
  );

  it('returns partial counts when the worker acknowledges cancellation', async () => {
    const processor = new ImportsProcessor(
      {},
      {} as never,
      {
        getObjectStream: jest.fn().mockResolvedValue(Readable.from([])),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        emitJobProgress: jest.fn(),
        emitJobFailed: jest.fn(),
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
    await expect(
      processor['handle']({
        name: 'import-raw-materials',
        data: { userId: 'owner', fileKey: 'upload', cancelRequested: true },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as never),
    ).resolves.toEqual({
      status: 'cancelled',
      successCount: 0,
      failCount: 0,
      errors: [],
    });
  });
});
