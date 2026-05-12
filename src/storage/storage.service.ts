import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageProvider, UploadResult } from './interfaces/storage-provider.interface';
import { MinioStorageProvider } from './providers/minio.provider';
import { S3StorageProvider } from './providers/s3.provider';

@Injectable()
export class StorageService implements IStorageProvider, OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider: IStorageProvider;

  constructor(private readonly configService: ConfigService) {
    const providerName = configService.get<string>('STORAGE_PROVIDER', 'minio').toLowerCase();

    switch (providerName) {
      case 's3':
        this.provider = new S3StorageProvider(configService);
        break;
      case 'minio':
      default:
        this.provider = new MinioStorageProvider(configService);
        break;
    }

    this.logger.log(`Storage provider: ${providerName.toUpperCase()}`);
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
}
