import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defer, firstValueFrom } from 'rxjs';
import type { Job } from 'bullmq';
import ExcelJS from 'exceljs';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportsProcessor } from './processors/imports.processor';

type LocalImportJob = Job<{
  userId: string;
  filePath: string;
  fileName: string;
}>;

describe('Raw material uploads without object storage', () => {
  let directory: string;
  let filePath: string;
  const csv = 'Product Code,Name,Unit,Price\nRM-001,Rice,KG,15000\n';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'raw-material-import-'));
    filePath = join(directory, 'upload');
    await writeFile(filePath, csv);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  const makeProcessor = () => {
    const rawMaterials = {
      findExistingProductCodes: jest.fn().mockResolvedValue(new Set()),
      bulkUpsertByProductCode: jest.fn().mockResolvedValue(undefined),
      bulkUpsertVendorPrices: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = {
      emitJobProgress: jest.fn(),
      emitJobDone: jest.fn(),
      emitJobFailed: jest.fn(),
      create: jest.fn().mockResolvedValue(undefined),
    };
    const files = { getObjectStream: jest.fn() };
    const processor = new ImportsProcessor(
      {},
      { getJob: jest.fn().mockResolvedValue(undefined) } as never,
      files as never,
      {} as never,
      {} as never,
      rawMaterials as never,
      notifications as never,
    );
    return { processor, rawMaterials, notifications, files };
  };

  it.each(['csv', 'xlsx'])(
    'imports %s data and prices after audit storage fails and deletes the original upload',
    async (extension) => {
      if (extension === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Prices');
        sheet.addRow(['Product Code', 'Name', 'Unit', 'Price']);
        sheet.addRow(['RM-001', 'Rice', 'KG', 15000]);
        await workbook.xlsx.writeFile(filePath);
      }
      const originalContent = await readFile(filePath);
      const enqueueRawMaterials = jest
        .fn()
        .mockResolvedValue({ jobId: 'job-1' });
      const controller = new ImportsController({
        enqueueRawMaterials,
      } as never);
      const audit = {
        record: jest
          .fn<Promise<void>, [unknown]>()
          .mockResolvedValue(undefined),
      };
      const storage = {
        uploadObject: jest
          .fn()
          .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9000')),
      };
      const interceptor = new AuditInterceptor(
        audit as never,
        storage as never,
      );
      const file = {
        path: filePath,
        originalname: `prices.${extension}`,
        mimetype:
          extension === 'csv'
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      const request = {
        method: 'POST',
        originalUrl: '/imports/raw-materials/upload',
        params: {},
        file,
        user: { sub: 'user-1' },
        get: () => 'Test browser',
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => ({ statusCode: 201 }),
        }),
      };

      await expect(
        firstValueFrom(
          interceptor.intercept(context as never, {
            handle: () =>
              defer(() =>
                controller.importRawMaterialsUpload(request as never, file),
              ),
          }),
        ),
      ).resolves.toEqual({ jobId: 'job-1' });
      await expect(access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(`${filePath}.import`)).resolves.toEqual(
        originalContent,
      );
      expect(enqueueRawMaterials).toHaveBeenCalledWith(
        'user-1',
        undefined,
        file.originalname,
        file.mimetype,
        `${filePath}.import`,
      );
      expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
        success: true,
        details: { files: [{ contentStored: false }] },
      });

      const { processor, rawMaterials, notifications, files } = makeProcessor();
      await processor['handleRawMaterials']({
        id: 'job-1',
        data: {
          userId: 'user-1',
          filePath: `${filePath}.import`,
          fileName: file.originalname,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as LocalImportJob);
      expect(files.getObjectStream).not.toHaveBeenCalled();
      expect(rawMaterials.bulkUpsertByProductCode).toHaveBeenCalledWith([
        expect.objectContaining({
          productCode: 'RM-001',
          name: 'Rice',
          price: 15000,
        }),
      ]);
      expect(rawMaterials.bulkUpsertVendorPrices).toHaveBeenCalledWith([
        expect.objectContaining({ productCode: 'RM-001', price: 15000 }),
      ]);
      expect(notifications.emitJobDone).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ successCount: 1, failCount: 0 }),
      );
      await expect(access(`${filePath}.import`)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('removes the worker copy when enqueue fails and leaves the audit upload available', async () => {
    const error = new Error('Queue unavailable');
    const controller = new ImportsController({
      enqueueRawMaterials: jest.fn().mockRejectedValue(error),
    } as never);
    await expect(
      controller.importRawMaterialsUpload(
        { user: { sub: 'user-1' } } as never,
        { path: filePath, originalname: 'prices.csv', mimetype: 'text/csv' },
      ),
    ).rejects.toBe(error);
    await expect(access(`${filePath}.import`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(filePath, 'utf8')).resolves.toBe(csv);
  });

  it('keeps the worker file for retries and removes it after the last failure', async () => {
    const { processor, notifications } = makeProcessor();
    notifications.emitJobProgress.mockImplementation(() => {
      throw new Error('Temporary processing failure');
    });
    const job = {
      data: { userId: 'user-1', filePath, fileName: 'prices.csv' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as LocalImportJob;
    await expect(processor['handleRawMaterials'](job)).rejects.toThrow(
      'Temporary processing failure',
    );
    await expect(access(filePath)).resolves.toBeUndefined();
    job.attemptsMade = 2;
    await expect(processor['handleRawMaterials'](job)).rejects.toThrow(
      'Temporary processing failure',
    );
    await expect(access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans the file when a queued job is cancelled', async () => {
    const job = {
      name: 'import-raw-materials',
      data: { userId: 'user-1', filePath },
      getState: jest.fn().mockResolvedValue('waiting'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ImportsService({
      getJob: jest.fn().mockResolvedValue(job),
    } as never);
    await expect(service.cancelImportJob('user-1', 'job-1')).resolves.toEqual({
      jobId: 'job-1',
      status: 'cancelled',
    });
    await expect(access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains the file when removal of a queued job fails', async () => {
    const job = {
      name: 'import-raw-materials',
      data: { userId: 'user-1', filePath },
      getState: jest.fn().mockResolvedValue('waiting'),
      remove: jest.fn().mockRejectedValue(new Error('Job became active')),
    };
    const service = new ImportsService({
      getJob: jest.fn().mockResolvedValue(job),
    } as never);
    await expect(service.cancelImportJob('user-1', 'job-1')).rejects.toThrow(
      'Job became active',
    );
    await expect(access(filePath)).resolves.toBeUndefined();
  });
});
