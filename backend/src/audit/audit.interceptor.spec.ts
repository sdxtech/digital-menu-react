import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addAuditDatabaseChange } from './audit-context';
import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
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
});
