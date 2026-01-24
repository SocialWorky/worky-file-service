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
    } catch (error) {
      this.logger.error(`Error checking/creating bucket: ${error.message}`);
    }
  }

  /**
   * Uploads a file to MinIO
   * @param filePath Local path of the file
   * @param destination Destination folder in bucket (e.g., 'posts', 'profiles')
   * @param fileName Name of the file in MinIO
   * @returns URL of the uploaded file
   */
  async uploadFile(filePath: string, destination: string, fileName: string): Promise<string> {
    const objectName = `${destination}/${fileName}`;
    const metaData = {
      'Content-Type': this.getContentType(fileName),
    };

    try {
      await this.minioClient.fPutObject(this.bucket, objectName, filePath, metaData);
      this.logger.log(`File uploaded: ${objectName}`);

      // Return the public URL
      const minioPublicUrl = this.configService.get<string>('MINIO_PUBLIC_URL', 'http://localhost:9000');
      return `${minioPublicUrl}/${this.bucket}/${objectName}`;
    } catch (error) {
      this.logger.error(`Error uploading file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Uploads a file from buffer to MinIO
   * @param buffer File buffer
   * @param destination Destination folder in bucket
   * @param fileName Name of the file in MinIO
   * @returns URL of the uploaded file
   */
  async uploadBuffer(buffer: Buffer, destination: string, fileName: string): Promise<string> {
    const objectName = `${destination}/${fileName}`;
    const metaData = {
      'Content-Type': this.getContentType(fileName),
    };

    try {
      await this.minioClient.putObject(this.bucket, objectName, buffer, buffer.length, metaData);
      this.logger.log(`Buffer uploaded: ${objectName}`);

      const minioPublicUrl = this.configService.get<string>('MINIO_PUBLIC_URL', 'http://localhost:9000');
      return `${minioPublicUrl}/${this.bucket}/${objectName}`;
    } catch (error) {
      this.logger.error(`Error uploading buffer: ${error.message}`);
      throw error;
    }
  }

  /**
   * Deletes a file from MinIO
   * @param objectName Full path of the object in the bucket
   */
  async deleteFile(objectName: string): Promise<void> {
    try {
      await this.minioClient.removeObject(this.bucket, objectName);
      this.logger.log(`File deleted: ${objectName}`);
    } catch (error) {
      this.logger.error(`Error deleting file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets a presigned URL for downloading a file
   * @param objectName Full path of the object in the bucket
   * @param expirySeconds Expiry time in seconds (default: 24 hours)
   * @returns Presigned URL
   */
  async getPresignedUrl(objectName: string, expirySeconds: number = 86400): Promise<string> {
    try {
      return await this.minioClient.presignedGetObject(this.bucket, objectName, expirySeconds);
    } catch (error) {
      this.logger.error(`Error getting presigned URL: ${error.message}`);
      throw error;
    }
  }

  /**
   * Uploads multiple files from a directory to MinIO
   * @param directory Local directory path
   * @param destination Destination folder in bucket
   * @param fileNames Array of file names to upload
   * @returns Object with file names and their URLs
   */
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

  /**
   * Gets content type based on file extension
   */
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
