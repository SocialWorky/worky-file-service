import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageProvider, StorageHealth, UploadResult } from './interfaces/storage-provider.interface';
import { MinioStorageProvider } from './providers/minio.provider';
import { S3StorageProvider } from './providers/s3.provider';
import { LocalStorageProvider } from './providers/local.provider';

@Injectable()
export class StorageService implements IStorageProvider, OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider: IStorageProvider;

  constructor(private readonly configService: ConfigService) {
    const providerName = this.resolveProviderName(configService);

    switch (providerName) {
      case 's3':
        this.provider = new S3StorageProvider(configService);
        break;
      case 'local':
        this.provider = new LocalStorageProvider(configService);
        break;
      case 'minio':
      default:
        this.provider = new MinioStorageProvider(configService);
        break;
    }

    this.logger.log(`Storage provider: ${providerName.toUpperCase()}`);
  }

  /**
   * Honor an explicit STORAGE_PROVIDER; otherwise auto-detect from the environment so the
   * service degrades to filesystem storage when no object store is configured:
   *   MinIO env present  -> minio
   *   AWS S3 env present -> s3
   *   neither            -> local (filesystem, as before MinIO was introduced)
   */
  private resolveProviderName(config: ConfigService): string {
    const explicit = config.get<string>('STORAGE_PROVIDER');
    if (explicit && explicit.trim()) return explicit.trim().toLowerCase();

    const hasMinio = !!(config.get<string>('MINIO_ENDPOINT') || config.get<string>('MINIO_PUBLIC_URL'));
    if (hasMinio) return 'minio';

    const hasS3 = !!(config.get<string>('AWS_S3_BUCKET') && config.get<string>('AWS_ACCESS_KEY_ID'));
    if (hasS3) return 's3';

    this.logger.warn(
      'No MinIO or AWS S3 environment configured — falling back to local filesystem storage. ' +
      'Set STORAGE_PROVIDER explicitly to silence this auto-detection.',
    );
    return 'local';
  }

  async onModuleInit(): Promise<void> {
    await this.provider.ensureBucket();
  }

  uploadFile(filePath: string, destination: string, fileName: string): Promise<UploadResult> {
    return this.provider.uploadFile(filePath, destination, fileName);
  }

  uploadBuffer(
    buffer: Buffer,
    destination: string,
    fileName: string,
    contentType?: string,
  ): Promise<UploadResult> {
    return this.provider.uploadBuffer(buffer, destination, fileName, contentType);
  }

  deleteFile(objectName: string): Promise<void> {
    return this.provider.deleteFile(objectName);
  }

  getPublicUrl(objectName: string): string {
    return this.provider.getPublicUrl(objectName);
  }

  getPresignedUrl(objectName: string, expirySeconds?: number): Promise<string> {
    return this.provider.getPresignedUrl(objectName, expirySeconds);
  }

  ensureBucket(): Promise<void> {
    return this.provider.ensureBucket();
  }

  checkHealth(): Promise<StorageHealth> {
    return this.provider.checkHealth();
  }
}
