import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';
import type { Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { FilesService } from '../files/files.service';
import { AuditService, CreateAuditLogInput } from './audit.service';
import { auditRequestStorage, AuditRequestContext } from './audit-context';
import { sanitizeAuditValue } from './audit-sanitizer';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      return next.handle();
    }
    const startedAt = Date.now();
    const auditContext: AuditRequestContext = { databaseChanges: [] };
    const requestStream = new Observable<unknown>((subscriber) =>
      auditRequestStorage.run(auditContext, () =>
        next.handle().subscribe(subscriber),
      ),
    );
    return requestStream.pipe(
      mergeMap((result: unknown) =>
        from(
          this.record(
            request,
            response.statusCode,
            true,
            startedAt,
            auditContext,
            result,
          ),
        ).pipe(mergeMap(() => of(result))),
      ),
      catchError((error: unknown) =>
        from(
          this.record(
            request,
            this.statusCode(error, response.statusCode),
            false,
            startedAt,
            auditContext,
            undefined,
            error,
          ),
        ).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private async record(
    request: AuthenticatedRequest,
    statusCode: number,
    success: boolean,
    startedAt: number,
    auditContext: AuditRequestContext,
    responseBody?: unknown,
    error?: unknown,
  ) {
    try {
      const path = request.originalUrl.split('?')[0] ?? request.path;
      const segments = path.split('/').filter(Boolean);
      const sanitizedBody = sanitizeAuditValue(request.body);
      const body =
        sanitizedBody &&
        typeof sanitizedBody === 'object' &&
        !Array.isArray(sanitizedBody)
          ? (sanitizedBody as Record<string, unknown>)
          : {};
      const files = await this.captureFiles(request);
      const user = request.user;
      const input: CreateAuditLogInput = {
        actorId: user?.sub,
        actorName: user?.name,
        actorEmail:
          user?.email ||
          (typeof body.email === 'string'
            ? body.email.toLowerCase()
            : undefined),
        role: user?.appRole || user?.roles?.[0],
        site: user?.site,
        module:
          segments[0] === 'superadmin'
            ? segments[1] || 'superadmin'
            : segments[0] || 'application',
        action: `${request.method.toUpperCase()} ${segments.slice(1).join('/') || segments[0] || '/'}`,
        method: request.method.toUpperCase(),
        path,
        targetId: this.targetId(request.params),
        success,
        statusCode,
        ipAddress: request.ip,
        userAgent: request.get('user-agent')?.slice(0, 500),
        details: {
          ...(Object.keys(body).length ? { input: body } : {}),
          response: sanitizeAuditValue(
            success ? responseBody : this.errorResponse(error),
          ),
          ...(auditContext.databaseChanges.length
            ? {
                before:
                  auditContext.databaseChanges.length === 1
                    ? auditContext.databaseChanges[0].before
                    : auditContext.databaseChanges.map((item) => ({
                        collection: item.collection,
                        value: item.before,
                      })),
                after:
                  auditContext.databaseChanges.length === 1
                    ? auditContext.databaseChanges[0].after
                    : auditContext.databaseChanges.map((item) => ({
                        collection: item.collection,
                        value: item.after,
                      })),
                changes: auditContext.databaseChanges.map((item) => ({
                  collection: item.collection,
                  operation: item.operation,
                  fields: item.changes,
                  ...(item.truncated ? { truncated: true } : {}),
                })),
              }
            : {}),
          ...(files.length ? { files } : {}),
          durationMs: Date.now() - startedAt,
          ...(!success ? { error: this.errorMessage(error) } : {}),
        },
      };
      await this.audit.record(input);
    } catch (auditError) {
      this.logger.error(
        `Failed to write audit log: ${auditError instanceof Error ? auditError.message : String(auditError)}`,
      );
    }
  }

  private async captureFiles(request: AuthenticatedRequest) {
    const uploadRequest = request as AuthenticatedRequest & {
      file?: Record<string, unknown>;
      files?: Array<Record<string, unknown>> | Record<string, unknown[]>;
      auditPreserveUpload?: boolean;
    };
    const rawFiles: Array<Record<string, unknown>> = uploadRequest.file
      ? [uploadRequest.file]
      : Array.isArray(uploadRequest.files)
        ? uploadRequest.files
        : uploadRequest.files
          ? (Object.values(uploadRequest.files).flat() as Array<
              Record<string, unknown>
            >)
          : [];
    return Promise.all(
      rawFiles.map(async (file) => {
        const path = typeof file.path === 'string' ? file.path : undefined;
        const originalName =
          typeof file.originalname === 'string'
            ? file.originalname
            : 'uploaded-file';
        const metadata = {
          fieldName: file.fieldname,
          originalName,
          mimeType: file.mimetype,
          size: file.size,
        };
        if (!path) return { ...metadata, contentStored: false };
        try {
          const content = await readFile(path);
          const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const now = new Date();
          const key = `audit-uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}-${safeName}`;
          await this.files.uploadObject(
            key,
            Readable.from([content]),
            typeof file.mimetype === 'string'
              ? file.mimetype
              : 'application/octet-stream',
          );
          return {
            ...metadata,
            contentStored: true,
            storageKey: key,
            sha256: createHash('sha256').update(content).digest('hex'),
          };
        } catch (error) {
          return {
            ...metadata,
            contentStored: false,
            captureError:
              error instanceof Error ? error.message : 'File capture failed',
          };
        } finally {
          if (!uploadRequest.auditPreserveUpload) {
            try {
              await unlink(path);
            } catch (cleanupError) {
              if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.logger.error(
                  `Failed to clean audit upload: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
                );
              }
            }
          }
        }
      }),
    );
  }

  private targetId(params: Record<string, unknown>) {
    const value = params?.id ?? params?.productionCode;
    return typeof value === 'string' ? value : undefined;
  }

  private statusCode(error: unknown, fallback: number) {
    const value =
      (error as { status?: unknown; statusCode?: unknown })?.status ??
      (error as { statusCode?: unknown })?.statusCode;
    if (typeof value === 'number') return value;
    return fallback >= 400 ? fallback : 500;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error
      ? error.message.slice(0, 1_000)
      : 'Request failed';
  }

  private errorResponse(error: unknown) {
    if (!error || typeof error !== 'object') {
      return { message: this.errorMessage(error) };
    }
    const candidate = error as {
      name?: unknown;
      message?: unknown;
      status?: unknown;
      statusCode?: unknown;
      response?: unknown;
      getResponse?: unknown;
    };
    const exceptionResponse =
      typeof candidate.getResponse === 'function'
        ? (candidate.getResponse as () => unknown)()
        : candidate.response;
    return {
      name: candidate.name,
      message: candidate.message,
      statusCode: candidate.status ?? candidate.statusCode,
      ...(exceptionResponse !== undefined ? { body: exceptionResponse } : {}),
    };
  }
}
