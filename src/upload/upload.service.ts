import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as sharp from 'sharp';
import * as ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { promisify } from 'util';
import { MinioService } from '../minio/minio.service';

const unlinkAsync = promisify(fs.unlink);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly minioService: MinioService) {}
  /**
   * Processes the upload of multiple files.
   * @param files The files to upload.
   * @param userId The ID of the user uploading the files.
   * @param destination The destination folder in MinIO.
   * @returns A promise that resolves with an array of file processing results.
   */
  async uploadFiles(
    files: Express.Multer.File[],
    userId: string,
    destination?: string,
    idReference?: string,
    urlMedia?: string,
    type?: string,
  ): Promise<any[]> {
    const results = [];

    for (const file of files) {
      try {
        const result = await this.processFile(
          file,
          userId,
          destination,
          idReference,
          urlMedia,
          type,
        );
        results.push(result);
      } catch (error) {
        results.push({
          originalname: file.originalname,
          filename: file.filename,
          error: error.message,
          userId,
          destination,
          idReference,
          urlMedia,
          type,
        });
      }
    }

    return results;
  }

  /**
   * Processes a single file, optimizing it according to its type and uploading to MinIO.
   * @param file The file to process.
   * @param userId The ID of the user uploading the file.
   * @param destination The destination folder in MinIO (e.g., 'publications', 'emojis', 'comments').
   * @returns A promise that resolves with an object containing processed file information.
   * @throws Error if any problem occurs during file processing.
   */
  public async processFile(
    file: Express.Multer.File,
    userId: string,
    destination?: string,
    idReference?: string,
    urlMedia?: string,
    type?: string,
  ): Promise<any> {
    try {
      const optimizedData = await this.optimizeFile(file);
      const directory = path.dirname(file.path);
      // Use destination from body, fallback to type, then 'uploads'
      const minioDestination = destination || type || 'uploads';

      // Upload files to MinIO
      const minioUrls = await this.uploadToMinio(
        directory,
        minioDestination,
        file.filename,
        optimizedData,
      );

      // Clean up local files
      await this.cleanupLocalFiles(directory, file.filename, optimizedData);

      return {
        originalname: file.originalname,
        filename: file.filename,
        ...optimizedData,
        ...minioUrls,
        userId,
        idReference,
        urlMedia,
        type,
      };
    } catch (error) {
      this.logger.error(`Error processing file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Uploads processed files to MinIO
   */
  private async uploadToMinio(
    directory: string,
    destination: string,
    originalFilename: string,
    optimizedData: any,
  ): Promise<{ url: string; urlThumbnail: string; urlCompressed?: string; urlOptimized?: string }> {
    const urls: any = {};

    // Upload original file
    const originalPath = path.join(directory, originalFilename);
    if (fs.existsSync(originalPath)) {
      urls.url = await this.minioService.uploadFile(originalPath, destination, originalFilename);
    }

    // Upload thumbnail
    if (optimizedData.thumbnail) {
      const thumbnailPath = path.join(directory, optimizedData.thumbnail);
      if (fs.existsSync(thumbnailPath)) {
        urls.urlThumbnail = await this.minioService.uploadFile(
          thumbnailPath,
          destination,
          optimizedData.thumbnail,
        );
      }
    }

    // Upload compressed (for images)
    if (optimizedData.compressed) {
      const compressedPath = path.join(directory, optimizedData.compressed);
      if (fs.existsSync(compressedPath)) {
        urls.urlCompressed = await this.minioService.uploadFile(
          compressedPath,
          destination,
          optimizedData.compressed,
        );
      }
    }

    // Upload optimized (for videos)
    if (optimizedData.optimized) {
      const optimizedPath = path.join(directory, optimizedData.optimized);
      if (fs.existsSync(optimizedPath)) {
        urls.urlOptimized = await this.minioService.uploadFile(
          optimizedPath,
          destination,
          optimizedData.optimized,
        );
      }
    }

    // For videos, the original file is deleted during FFmpeg processing.
    // Fall back url to urlOptimized so the backend always receives a valid URL.
    if (!urls.url && urls.urlOptimized) {
      urls.url = urls.urlOptimized;
    }

    return urls;
  }

  /**
   * Cleans up local files after uploading to MinIO
   */
  private async cleanupLocalFiles(
    directory: string,
    originalFilename: string,
    optimizedData: any,
  ): Promise<void> {
    const filesToDelete = [originalFilename];

    if (optimizedData.thumbnail) filesToDelete.push(optimizedData.thumbnail);
    if (optimizedData.compressed) filesToDelete.push(optimizedData.compressed);
    if (optimizedData.optimized) filesToDelete.push(optimizedData.optimized);

    for (const fileName of filesToDelete) {
      const filePath = path.join(directory, fileName);
      try {
        if (fs.existsSync(filePath)) {
          await unlinkAsync(filePath);
          this.logger.log(`Deleted local file: ${filePath}`);
        }
      } catch (error) {
        this.logger.warn(`Could not delete file ${filePath}: ${error.message}`);
      }
    }
  }

  /**
   * Optimizes a file according to its type (image or video).
   * @param file The file to optimize.
   * @returns A promise that resolves with an object containing optimized file information.
   * @throws Error if the file type is not supported.
   */
  private async optimizeFile(
    file: Express.Multer.File,
  ): Promise<
    | { thumbnail: string; compressed: string }
    | { optimized: string; thumbnail?: string }
  > {
    const filePath = file.path;
    const fileType = file.mimetype.split('/')[0];

    if (fileType === 'image') {
      return this.optimizeImage(filePath);
    } else if (fileType === 'video') {
      return this.optimizeVideo(filePath);
    }

    throw new Error(`Unsupported file type: ${fileType}`);
  }

  /**
   * Optimizes an image, creating a compressed version and a thumbnail.
   * @param filePath The path of the image file.
   * @returns A promise that resolves with an object containing the paths of the compressed image and thumbnail.
   * @throws Error if any problem occurs during image optimization.
   */
  private async optimizeImage(
    filePath: string,
  ): Promise<{ thumbnail: string; compressed: string }> {
    const directory = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);

    // Use forward slash (/) instead of pipe (|) to avoid MinIO URL encoding issues
    // This creates a subdirectory structure: compressed/filename.jpg
    const compressedPath = path.join(directory, `compressed-${basename}${ext}`);
    const thumbnailPath = path.join(directory, `thumbnail-${basename}${ext}`);

    // Ensure directories exist
    const compressedDir = path.dirname(compressedPath);
    const thumbnailDir = path.dirname(thumbnailPath);
    if (!fs.existsSync(compressedDir)) {
      fs.mkdirSync(compressedDir, { recursive: true });
    }
    if (!fs.existsSync(thumbnailDir)) {
      fs.mkdirSync(thumbnailDir, { recursive: true });
    }

    try {
      await sharp(filePath)
        .rotate()
        .resize({ width: 800 })
        .toFile(compressedPath);

      await sharp(filePath)
        .rotate()
        .resize({ width: 200 })
        .toFile(thumbnailPath);
    } catch (error) {
      throw error;
    }

    // Return paths with forward slash for MinIO compatibility
    return {
      compressed: `compressed-${basename}${ext}`,
      thumbnail: `thumbnail-${basename}${ext}`,
    };
  }

  /**
   * Optimizes a video, creating a smaller optimized version and a thumbnail.
   * @param filePath The path of the video file.
   * @returns A promise that resolves with an object containing the path of the optimized video and thumbnail.
   * @throws Error if any problem occurs during video optimization.
   */
  private async optimizeVideo(
    filePath: string,
  ): Promise<{ optimized: string; thumbnail: string }> {
    const directory = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    // Use forward slash (/) instead of pipe (|) to avoid MinIO URL encoding issues
    const optimizedPath = path.join(directory, `worky-${basename}.mp4`);

    // Ensure directory exists
    const optimizedDir = path.dirname(optimizedPath);
    if (!fs.existsSync(optimizedDir)) {
      fs.mkdirSync(optimizedDir, { recursive: true });
    }

    const optimizedBasename = `worky-${basename}`;
    const thumbnailFilename = `thumbnail-${optimizedBasename}.jpg`;

    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .outputOptions([
          '-c:v libx264',
          '-crf 23',
          '-preset fast',
          '-vf scale=-2:720',
          '-pix_fmt yuv420p',
        ])
        .output(optimizedPath)
        .on('end', async () => {
          try {
            await unlinkAsync(filePath);

            await this.generateVideoThumbnail(optimizedPath, directory, thumbnailFilename);

            resolve({
              optimized: `${optimizedBasename}.mp4`,
              thumbnail: thumbnailFilename,
            });
          } catch (err) {
            reject(err);
          }
        })
        .on('error', (err) => {
          reject(err);
        })
        .run();
    });
  }

  /**
   * Extracts a frame from the video to use as a thumbnail.
   * @param filePath Path of the video file.
   * @returns A promise that resolves with the path of the thumbnail.
   * @throws Error if a problem occurs during extraction.
   */
  private async generateVideoThumbnail(filePath: string, outputDir: string, thumbnailFilename: string): Promise<string> {
    const thumbnailPath = path.join(outputDir, thumbnailFilename);

    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .screenshots({
          count: 1,
          folder: outputDir,
          filename: thumbnailFilename,
          size: '320x240',
          timemarks: ['00:00:01'],
        })
        .on('end', () => {
          if (fs.existsSync(thumbnailPath)) {
            resolve(thumbnailFilename);
          } else {
            reject(new Error('Thumbnail not generated'));
          }
        })
        .on('error', (err) => {
          reject(err);
        });
    });
  }
}
