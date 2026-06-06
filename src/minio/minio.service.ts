import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private minioClient: Minio.Client;
  private bucket: string;

  constructor(private configService: ConfigService) {
    this.bucket = this.configService.get<string>('MINIO_BUCKET', 'social-network-files');

    this.minioClient = new Minio.Client({
      endPoint: this.configService.get<string>('MINIO_ENDPOINT', 'localhost'),
      port: parseInt(this.configService.get<string>('MINIO_PORT', '9000')),
      useSSL: this.configService.get<string>('MINIO_USE_SSL', 'false') === 'true',
      accessKey: this.configService.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
      secretKey: this.configService.get<string>('MINIO_SECRET_KEY', 'minioadmin123'),
    });
  }

  async onModuleInit() {
    try {
      const bucketExists = await this.minioClient.bucketExists(this.bucket);
      if (!bucketExists) {
        await this.minioClient.makeBucket(this.bucket);
        this.logger.log(`Bucket "${this.bucket}" created successfully`);
      } else {
        this.logger.log(`Bucket "${this.bucket}" already exists`);
      }
      
      await this.setBucketPublicPolicy();
      await this.setBucketCorsPolicy();
    } catch (error) {
      this.logger.error(`Error checking/creating bucket: ${error.message}`);
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

      await this.minioClient.setBucketPolicy(this.bucket, JSON.stringify(policy));
      this.logger.log(`Bucket policy set for "${this.bucket}"`);
    } catch (error) {
      this.logger.warn(`Could not set bucket policy: ${error.message}`);
    }
  }

  // CORS must be configured at the MinIO server level via the Console or `mc` CLI, not via the SDK.
  private async setBucketCorsPolicy(): Promise<void> {
    this.logger.log('CORS must be configured at the MinIO server level');
  }

  async uploadFile(filePath: string, destination: string, fileName: string): Promise<string> {
    const objectName = `${destination}/${fileName}`;
    const metaData = {
      'Content-Type': this.getContentType(fileName),
    };

    try {
      await this.minioClient.fPutObject(this.bucket, objectName, filePath, metaData);
      this.logger.log(`File uploaded: ${objectName}`);
      return objectName;
    } catch (error) {
      this.logger.error(`Error uploading file: ${error.message}`);
      throw error;
    }
  }

  async uploadBuffer(buffer: Buffer, destination: string, fileName: string): Promise<string> {
    const objectName = `${destination}/${fileName}`;
    const metaData = {
      'Content-Type': this.getContentType(fileName),
    };

    try {
      await this.minioClient.putObject(this.bucket, objectName, buffer, buffer.length, metaData);
      this.logger.log(`Buffer uploaded: ${objectName}`);
      return objectName;
    } catch (error) {
      this.logger.error(`Error uploading buffer: ${error.message}`);
      throw error;
    }
  }

  async deleteFile(objectName: string): Promise<void> {
    try {
      await this.minioClient.removeObject(this.bucket, objectName);
      this.logger.log(`File deleted: ${objectName}`);
    } catch (error) {
      this.logger.error(`Error deleting file: ${error.message}`);
      throw error;
    }
  }

  async getPresignedUrl(objectName: string, expirySeconds: number = 86400): Promise<string> {
    try {
      return await this.minioClient.presignedGetObject(this.bucket, objectName, expirySeconds);
    } catch (error) {
      this.logger.error(`Error getting presigned URL: ${error.message}`);
      throw error;
    }
  }

  async uploadMultipleFiles(
    directory: string,
    destination: string,
    fileNames: string[],
  ): Promise<Record<string, string>> {
    const results: Record<string, string> = {};

    for (const fileName of fileNames) {
      const filePath = path.join(directory, fileName);
      if (fs.existsSync(filePath)) {
        results[fileName] = await this.uploadFile(filePath, destination, fileName);
      }
    }

    return results;
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
