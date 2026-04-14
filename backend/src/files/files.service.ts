import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

type UploadResult = { key: string; url: string; publicUrl: string };

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
]);
const ALLOWED_PREFIX_ROOTS = new Set([
  'recipes',
  'products',
  'imports',
  'exports',
  'raw-materials',
]);

@Injectable()
export class FilesService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('S3_BUCKET');
    this.publicBaseUrl = this.config.getOrThrow<string>('S3_PUBLIC_BASE_URL');

    this.s3 = new S3Client({
      region: this.config.getOrThrow<string>('S3_REGION'),
      endpoint: this.config.get<string>('S3_ENDPOINT'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });
  }

  async presignUpload(
    contentType: string,
    prefix?: string,
    fileSize?: number,
  ): Promise<UploadResult> {
    const normalizedContentType = this.normalizeContentType(contentType);
    if (!normalizedContentType) {
      throw new BadRequestException('contentType is required');
    }
    if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(normalizedContentType)) {
      throw new BadRequestException('contentType is not allowed');
    }
    if (fileSize !== undefined) {
      if (!Number.isInteger(fileSize) || fileSize <= 0) {
        throw new BadRequestException('fileSize must be a positive integer');
      }
      if (fileSize > MAX_UPLOAD_BYTES) {
        throw new BadRequestException(
          `fileSize must not exceed ${MAX_UPLOAD_BYTES} bytes`,
        );
      }
    }

    const key = this.buildKey(prefix);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: normalizedContentType,
      ...(fileSize !== undefined ? { ContentLength: fileSize } : {}),
    });
    const url = await getSignedUrl(this.s3, command, { expiresIn: 300 });
    const publicUrl = this.getPublicUrl(key);
    return { key, url, publicUrl };
  }

  async getObjectStream(key: string): Promise<Readable> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!response.Body) throw new BadRequestException('File not found');
    if (response.Body instanceof Readable) return response.Body;

    return Readable.from(response.Body as AsyncIterable<Uint8Array>);
  }

  async uploadObject(
    key: string,
    body: Readable | string,
    contentType: string,
  ) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    return this.getPublicUrl(key);
  }

  getPublicUrl(key: string) {
    const base = this.publicBaseUrl.replace(/\/+$/g, '');
    return `${base}/${key}`;
  }

  private buildKey(prefix?: string) {
    const safePrefix = this.sanitizePrefix(prefix);
    const id = randomUUID();
    return safePrefix ? `${safePrefix}/${id}` : id;
  }

  private sanitizePrefix(prefix?: string) {
    if (!prefix) return undefined;
    const normalized = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized) return undefined;

    const segments = normalized.split('/');
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      throw new BadRequestException('prefix is invalid');
    }

    if (normalized.includes('..')) {
      throw new BadRequestException('prefix is invalid');
    }

    const [root] = segments;
    if (!root || !ALLOWED_PREFIX_ROOTS.has(root)) {
      throw new BadRequestException('prefix is not allowed');
    }

    return normalized;
  }

  private normalizeContentType(contentType: string) {
    return contentType?.trim().toLowerCase().split(';')[0]?.trim();
  }
}
