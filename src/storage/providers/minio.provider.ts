import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import * as path from 'path';
import { IStorageProvider, StorageHealth, UploadResult } from '../interfaces/storage-provider.interface';

const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_BASE_DELAY_MS = 500;
const HEALTH_CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

async function withRetry<T>(
  logger: Logger,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: Error;
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < UPLOAD_MAX_ATTEMPTS) {
        const delay = UPLOAD_BASE_DELAY_MS * 2 ** (attempt - 1);
        const e = err as any;
        const parts = [
          e.code ? `[${e.code}]` : '[no-code]',
          e.message || '(no message)',
          e.resource ? `resource=${e.resource}` : '',
          e.amzRequestid ? `requestId=${e.amzRequestid}` : '',
        ].filter(Boolean).join(' ');
        logger.warn(`${label} attempt ${attempt} failed — retrying in ${delay}ms: ${parts}`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export class MinioStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(MinioStorageProvider.name);
  private readonly client: Minio.Client;
  private readonly bucket: string;
  private readonly publicUrl: string;
  private bucketReady = false;

  constructor(private readonly configService: ConfigService) {
    this.bucket = configService.get<string>('MINIO_BUCKET', 'social-network-files');
    this.publicUrl = configService.get<string>('MINIO_PUBLIC_URL', 'http://localhost:9000');

    if (!this.bucket || !this.bucket.trim()) {
      throw new Error(
        'MINIO_BUCKET is not defined. Set a non-empty bucket name in the environment — ' +
        'the file service cannot store or serve files without a target bucket.',
      );
    }

    this.client = new Minio.Client({
      endPoint: configService.get<string>('MINIO_ENDPOINT', 'localhost'),
      port: parseInt(configService.get<string>('MINIO_PORT', '9000')),
      useSSL: configService.get<string>('MINIO_USE_SSL', 'false') === 'true',
      accessKey: configService.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
      secretKey: configService.get<string>('MINIO_SECRET_KEY', 'minioadmin123'),
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      const bucketExists = await this.client.bucketExists(this.bucket);
      if (!bucketExists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Bucket "${this.bucket}" created successfully`);
      } else {
        this.logger.log(`Bucket "${this.bucket}" already exists`);
      }

      await this.setBucketPublicPolicy();
      // CORS must be configured at the MinIO server level via the Console or `mc` CLI, not via the SDK.
      this.logger.log('CORS must be configured at the MinIO server level');
      this.bucketReady = true;
    } catch (error) {
      // Do not crash the pod on a transient MinIO outage — leave the bucket marked
      // not-ready so the readiness probe reports the service as unavailable until MinIO recovers.
      this.bucketReady = false;
      this.logger.error(
        `MinIO not ready — could not verify/create bucket "${this.bucket}": ${error.message}. ` +
        'Uploads will fail and /health/ready will report unhealthy until MinIO is reachable.',
      );
    }
  }

  async checkHealth(): Promise<StorageHealth> {
    try {
      const bucketExists = await withTimeout(
        this.client.bucketExists(this.bucket),
        HEALTH_CHECK_TIMEOUT_MS,
        `bucketExists(${this.bucket})`,
      );
      if (bucketExists) {
        this.bucketReady = true;
      }
      return {
        healthy: bucketExists,
        bucketExists,
        detail: bucketExists
          ? `Bucket "${this.bucket}" reachable`
          : `Bucket "${this.bucket}" does not exist`,
      };
    } catch (error) {
      this.bucketReady = false;
      return {
        healthy: false,
        bucketExists: false,
        detail: `MinIO unreachable: ${error.message}`,
      };
    }
  }

  private async setBucketPublicPolicy(): Promise<void> {
    try {
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucket}/*`],
          },
        ],
      };

      await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy));
      this.logger.log(`Bucket policy set for "${this.bucket}"`);
    } catch (error) {
      this.logger.warn(`Could not set bucket policy: ${error.message}`);
    }
  }

  async uploadFile(filePath: string, destination: string, fileName: string): Promise<UploadResult> {
    const objectName = `${destination}/${fileName}`;
    const metaData = { 'Content-Type': this.getContentType(fileName) };

    await withRetry(this.logger, `fPutObject(${objectName})`, () =>
      this.client.fPutObject(this.bucket, objectName, filePath, metaData),
    );

    this.logger.log(`File uploaded: ${objectName}`);
    return { objectName, publicUrl: this.getPublicUrl(objectName) };
  }

  async uploadBuffer(
    buffer: Buffer,
    destination: string,
    fileName: string,
    contentType?: string,
  ): Promise<UploadResult> {
    const objectName = `${destination}/${fileName}`;
    const metaData = { 'Content-Type': contentType || this.getContentType(fileName) };

    await withRetry(this.logger, `putObject(${objectName})`, () =>
      this.client.putObject(this.bucket, objectName, buffer, buffer.length, metaData),
    );

    this.logger.log(`Buffer uploaded: ${objectName}`);
    return { objectName, publicUrl: this.getPublicUrl(objectName) };
  }

  async deleteFile(objectName: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, objectName);
      this.logger.log(`File deleted: ${objectName}`);
    } catch (error) {
      this.logger.error(`Error deleting file: ${error.message}`);
      throw error;
    }
  }

  getPublicUrl(objectName: string): string {
    return `${this.publicUrl}/${this.bucket}/${objectName}`;
  }

  async getPresignedUrl(objectName: string, expirySeconds: number = 86400): Promise<string> {
    try {
      return await this.client.presignedGetObject(this.bucket, objectName, expirySeconds);
    } catch (error) {
      this.logger.error(`Error getting presigned URL: ${error.message}`);
      throw error;
    }
  }

  private getContentType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.pdf': 'application/pdf',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
