export interface UploadResult {
  objectName: string;
  publicUrl: string;
}

export interface StorageHealth {
  healthy: boolean;
  bucketExists: boolean;
  detail: string;
}

export interface IStorageProvider {
  ensureBucket(): Promise<void>;
  checkHealth(): Promise<StorageHealth>;
  uploadFile(filePath: string, destination: string, fileName: string): Promise<UploadResult>;
  uploadBuffer(buffer: Buffer, destination: string, fileName: string, contentType?: string): Promise<UploadResult>;
  deleteFile(objectName: string): Promise<void>;
  getPublicUrl(objectName: string): string;
  getPresignedUrl(objectName: string, expirySeconds?: number): Promise<string>;
}
