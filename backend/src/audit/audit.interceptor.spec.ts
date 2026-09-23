import { firstValueFrom, Observable, of, throwError, defer } from 'rxjs';
import { Logger } from '@nestjs/common';
import { access, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addAuditDatabaseChange } from './audit-context';
import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
  afterEach(() => jest.restoreAllMocks());
  const files = { uploadObject: jest.fn().mockResolvedValue(undefined) };
  const makeContext = (
    body?: Record<string, unknown>,
    file?: Record<string, unknown>,
  ) => {
    const request = {
      method: 'PATCH',
      originalUrl: '/auth/password',
      path: '/auth/password',
      body,
      file,
      params: {},
      ip: '127.0.0.1',
      user: {
        sub: 'user-1',
        name: 'Chef',
        email: 'chef@example.com',
        appRole: 'chef',
        roles: ['chef'],
        site: 'S001',
      },
      get: jest.fn().mockReturnValue('Test browser'),
    };
    const response = { statusCode: 200 };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    };
  };

  it('redacts credentials before recording a successful request', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(audit as never, files as never);

    await firstValueFrom(
      interceptor.intercept(
        makeContext({ currentPassword: 'old', newPassword: 'new' }) as never,
        {
          handle: () => of({ ok: true }),
        },
      ),
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        details: expect.objectContaining({
          input: { currentPassword: '[REDACTED]', newPassword: '[REDACTED]' },
        }),
      }),
    );
  });

  it('records a failed request and preserves the original error', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(audit as never, files as never);
    const error = Object.assign(new Error('Denied'), { status: 403 });

    await expect(
      firstValueFrom(
        interceptor.intercept(makeContext({}) as never, {
          handle: () => throwError(() => error),
        }),
      ),
    ).rejects.toBe(error);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, statusCode: 403 }),
    );
  });

  it('records a mutation request without a body', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(audit as never, files as never);

    await firstValueFrom(
      interceptor.intercept(makeContext() as never, {
        handle: () => of({ ok: true }),
      }),
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        details: expect.not.objectContaining({ input: expect.anything() }),
      }),
    );
  });

  it('records the sanitized response and database before/after diff', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(audit as never, files as never);

    await firstValueFrom(
      interceptor.intercept(makeContext({ name: 'New name' }) as never, {
        handle: () =>
          new Observable((subscriber) => {
            addAuditDatabaseChange({
              collection: 'recipes',
              operation: 'findOneAndUpdate',
              before: { name: 'Old name' },
              after: { name: 'New name' },
              changes: {
                name: { before: 'Old name', after: 'New name' },
              },
            });
            subscriber.next({ name: 'New name', accessToken: 'secret' });
            subscriber.complete();
          }),
      }),
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          before: { name: 'Old name' },
          after: { name: 'New name' },
          response: { name: 'New name', accessToken: '[REDACTED]' },
          changes: [
            expect.objectContaining({
              collection: 'recipes',
              fields: {
                name: { before: 'Old name', after: 'New name' },
              },
            }),
          ],
        }),
      }),
    );
  });

  it('stores an uploaded file and records its hash and storage key', async () => {
    const path = join(tmpdir(), `audit-upload-${Date.now()}.csv`);
    await writeFile(path, 'code,name\n1,Test');
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(audit as never, files as never);

    await firstValueFrom(
      interceptor.intercept(
        makeContext(
          {},
          {
            path,
            originalname: 'import.csv',
            mimetype: 'text/csv',
            size: 16,
            fieldname: 'file',
          },
        ) as never,
        { handle: () => of({ imported: 1 }) },
      ),
    );

    expect(files.uploadObject).toHaveBeenCalledWith(
      expect.stringMatching(/^audit-uploads\//),
      expect.anything(),
      'text/csv',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          files: [
            expect.objectContaining({
              originalName: 'import.csv',
              contentStored: true,
              sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
          ],
        }),
      }),
    );
    await expect(access(path)).rejects.toBeDefined();
  });

  it('cleans temporary imports and preserves the response when audit upload fails', async () => {
    const path = join(tmpdir(), `audit-failed-upload-${Date.now()}.csv`);
    await writeFile(path, 'code,name\n1,Test');
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const storage = {
      uploadObject: jest
        .fn()
        .mockRejectedValue(new Error('Storage unavailable')),
    };
    const interceptor = new AuditInterceptor(audit as never, storage as never);
    const result = { imported: 1 };
    try {
      await expect(
        firstValueFrom(
          interceptor.intercept(
            makeContext({}, { path, originalname: 'import.csv' }) as never,
            { handle: () => of(result) },
          ),
        ),
      ).resolves.toBe(result);
      expect(audit.record).toHaveBeenCalledTimes(1);
      await expect(access(path)).rejects.toBeDefined();
    } finally {
      await unlink(path).catch(() => undefined);
    }
  });

  it.each([false, true])(
    'preserves the API outcome when audit database writing fails (business failure: %s)',
    async (failed) => {
      const logger = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const audit = {
        record: jest.fn().mockRejectedValue(new Error('Audit unavailable')),
      };
      const interceptor = new AuditInterceptor(audit as never, files as never);
      const error = Object.assign(new Error('Invalid data'), { status: 400 });
      const result = { saved: true };
      const response = firstValueFrom(
        interceptor.intercept(makeContext() as never, {
          handle: () => (failed ? throwError(() => error) : of(result)),
        }),
      );
      if (failed) await expect(response).rejects.toBe(error);
      else await expect(response).resolves.toBe(result);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'does not introduce audit work for %s requests',
    async (method) => {
      const audit = { record: jest.fn() };
      const interceptor = new AuditInterceptor(audit as never, files as never);
      const context = makeContext();
      context.switchToHttp().getRequest().method = method;
      await expect(
        firstValueFrom(
          interceptor.intercept(context as never, { handle: () => of('ok') }),
        ),
      ).resolves.toBe('ok');
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('isolates database changes between concurrent requests', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(audit as never, files as never);
    const runRequest = (name: string) =>
      firstValueFrom(
        interceptor.intercept(makeContext({ name }) as never, {
          handle: () =>
            defer(async () => {
              await new Promise<void>((resolve) => setImmediate(resolve));
              addAuditDatabaseChange({
                collection: 'recipes',
                operation: 'create',
                before: null,
                after: { name },
                changes: {},
              });
              await new Promise<void>((resolve) => setImmediate(resolve));
              return { name };
            }),
        }),
      );
    await Promise.all([runRequest('First'), runRequest('Second')]);
    expect(audit.record).toHaveBeenCalledTimes(2);
    for (const name of ['First', 'Second']) {
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            input: { name },
            after: { name },
            response: { name },
          }) as unknown,
        }),
      );
    }
  });

  it('keeps files explicitly retained by their owner', async () => {
    const path = join(tmpdir(), `audit-preserve-${Date.now()}.csv`);
    await writeFile(path, 'test');
    const context = makeContext({}, { path, originalname: 'import.csv' });
    Object.assign(context.switchToHttp().getRequest(), {
      auditPreserveUpload: true,
    });
    const interceptor = new AuditInterceptor(
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      files as never,
    );
    try {
      await firstValueFrom(
        interceptor.intercept(context as never, { handle: () => of('ok') }),
      );
      await expect(access(path)).resolves.toBeUndefined();
    } finally {
      await unlink(path);
    }
  });
});
