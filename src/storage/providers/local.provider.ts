import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { IStorageProvider, StorageHealth, UploadResult } from '../interfaces/storage-provider.interface';

const copyFileAsync = promisify(fs.copyFile);
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const mkdirAsync = promisify(fs.mkdir);

/**
 * Filesystem fallback used when neither MinIO nor S3 is configured. Files are persisted
 * under LOCAL_STORAGE_DIR (a directory separate from the multer temp `uploads` dir, so the
 * post-processing cleanup does not remove them) and served by the GET :type/:filename route.
 */
export class LocalStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly storageDir: string;
  private readonly publicUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.storageDir = configService.get<string>('LOCAL_STORAGE_DIR')
      || path.join(process.cwd(), 'storage');

    const port = configService.get<string>('APP_PORT', '3005');
    const base = configService.get<string>('LOCAL_PUBLIC_URL')
      || configService.get<string>('APP_URL')
      || configService.get<string>('BASE_URL')
      || `http://localhost:${port}`;
    this.publicUrl = base.replace(/\/+$/, '');
  }

  async ensureBucket(): Promise<void> {
    await mkdirAsync(this.storageDir, { recursive: true });
    this.logger.log(`Local storage ready at "${this.storageDir}" (served from ${this.publicUrl})`);
  }

  async checkHealth(): Promise<StorageHealth> {
    try {
      await fs.promises.access(this.storageDir, fs.constants.W_OK);
      return {
        healthy: true,
        bucketExists: true,
        detail: `Local storage dir "${this.storageDir}" is writable`,
      };
    } catch (error) {
      return {
        healthy: false,
        bucketExists: false,
        detail: `Local storage dir "${this.storageDir}" is not writable: ${error.message}`,
      };
    }
  }

  async uploadFile(filePath: string, destination: string, fileName: string): Promise<UploadResult> {
    const objectName = `${destination}/${fileName}`;
    const targetPath = this.resolveObjectPath(objectName);
    await mkdirAsync(path.dirname(targetPath), { recursive: true });
    await copyFileAsync(filePath, targetPath);
    this.logger.log(`File stored locally: ${objectName}`);
    return { objectName, publicUrl: this.getPublicUrl(objectName) };
  }

  async uploadBuffer(
    buffer: Buffer,
    destination: string,
    fileName: string,
  ): Promise<UploadResult> {
    const objectName = `${destination}/${fileName}`;
    const targetPath = this.resolveObjectPath(objectName);
    await mkdirAsync(path.dirname(targetPath), { recursive: true });
    await writeFileAsync(targetPath, buffer);
    this.logger.log(`Buffer stored locally: ${objectName}`);
    return { objectName, publicUrl: this.getPublicUrl(objectName) };
  }

  async deleteFile(objectName: string): Promise<void> {
    const targetPath = this.resolveObjectPath(objectName);
    try {
      await unlinkAsync(targetPath);
      this.logger.log(`Local file deleted: ${objectName}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  getPublicUrl(objectName: string): string {
    return `${this.publicUrl}/${objectName}`;
  }

  async getPresignedUrl(objectName: string): Promise<string> {
    // Local files are served publicly; there is nothing to sign.
    return this.getPublicUrl(objectName);
  }

  private resolveObjectPath(objectName: string): string {
    const targetPath = path.resolve(this.storageDir, objectName);
    const root = path.resolve(this.storageDir);
    if (targetPath !== root && !targetPath.startsWith(root + path.sep)) {
      throw new Error(`Invalid object path outside storage dir: ${objectName}`);
    }
    return targetPath;
  }
}
