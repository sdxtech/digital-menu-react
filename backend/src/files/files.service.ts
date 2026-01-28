import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

type UploadResult = { key: string; url: string; publicUrl: string };

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

  async presignUpload(contentType: string, prefix?: string): Promise<UploadResult> {
    if (!contentType?.trim()) {
      throw new BadRequestException('contentType is required');
    }

    const key = this.buildKey(prefix);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    // TODO: enforce content-length and antivirus scan before processing uploads.
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

  async uploadObject(key: string, body: Readable | string, contentType: string) {
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

    return normalized;
  }
}
