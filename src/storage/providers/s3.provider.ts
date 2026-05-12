import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { IStorageProvider, UploadResult } from '../interfaces/storage-provider.interface';

// Only load S3 SDK when STORAGE_PROVIDER=s3
let S3Client: any;
let PutObjectCommand: any;
let DeleteObjectCommand: any;
let GetObjectCommand: any;
let getSignedUrl: any;

try {
  const awsSdk = require('@aws-sdk/client-s3');
  S3Client = awsSdk.S3Client;
  PutObjectCommand = awsSdk.PutObjectCommand;
  DeleteObjectCommand = awsSdk.DeleteObjectCommand;
  GetObjectCommand = awsSdk.GetObjectCommand;
} catch {
  // Package not installed — will throw at runtime if S3 provider is selected
}

try {
  const presigner = require('@aws-sdk/s3-request-presigner');
  getSignedUrl = presigner.getSignedUrl;
} catch {
  // Optional presigner — will throw only if getPresignedUrl is called
}

export class S3StorageProvider implements IStorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: any;
  private readonly bucket: string;
  private readonly region: string;
  private readonly publicUrl: string;

  constructor(private readonly configService: ConfigService) {
    if (!S3Client) {
      throw new Error(
        'STORAGE_PROVIDER is set to "s3" but @aws-sdk/client-s3 is not installed. ' +
        'Run: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner',
      );
    }

    this.region = configService.get<string>('AWS_REGION', 'us-east-1');
    this.bucket = configService.get<string>('AWS_S3_BUCKET', 'social-network-files');

    const explicitPublicUrl = configService.get<string>('AWS_S3_PUBLIC_URL');
    this.publicUrl = explicitPublicUrl || `https://${this.bucket}.s3.${this.region}.amazonaws.com`;

    this.client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: configService.get<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: configService.get<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });
  }

  async ensureBucket(): Promise<void> {
    this.logger.warn(
      `S3 provider: bucket "${this.bucket}" must be created manually via AWS Console or CLI. ` +
      'Auto-creation is skipped to avoid IAM permission issues.',
    );
  }

  async uploadFile(filePath: string, destination: string, fileName: string): Promise<UploadResult> {
    const objectName = `${destination}/${fileName}`;
    const contentType = this.getContentType(fileName);

    try {
      const stream = fs.createReadStream(filePath);
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectName,
          Body: stream,
          ContentType: contentType,
        }),
      );
      this.logger.log(`File uploaded to S3: ${objectName}`);
      return { objectName, publicUrl: this.getPublicUrl(objectName) };
    } catch (error) {
      this.logger.error(`Error uploading file to S3: ${error.message}`);
      throw error;
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    destination: string,
    fileName: string,
    contentType?: string,
  ): Promise<UploadResult> {
    const objectName = `${destination}/${fileName}`;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectName,
          Body: buffer,
          ContentType: contentType || this.getContentType(fileName),
          ContentLength: buffer.length,
        }),
      );
      this.logger.log(`Buffer uploaded to S3: ${objectName}`);
      return { objectName, publicUrl: this.getPublicUrl(objectName) };
    } catch (error) {
      this.logger.error(`Error uploading buffer to S3: ${error.message}`);
      throw error;
    }
  }

  async deleteFile(objectName: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: objectName,
        }),
      );
      this.logger.log(`File deleted from S3: ${objectName}`);
    } catch (error) {
      this.logger.error(`Error deleting file from S3: ${error.message}`);
      throw error;
    }
  }

  getPublicUrl(objectName: string): string {
    return `${this.publicUrl}/${objectName}`;
  }

  async getPresignedUrl(objectName: string, expirySeconds: number = 86400): Promise<string> {
    if (!getSignedUrl) {
      throw new Error(
        '@aws-sdk/s3-request-presigner is not installed. ' +
        'Run: npm install @aws-sdk/s3-request-presigner',
      );
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectName,
      });
      return await getSignedUrl(this.client, command, { expiresIn: expirySeconds });
    } catch (error) {
      this.logger.error(`Error getting presigned URL from S3: ${error.message}`);
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
