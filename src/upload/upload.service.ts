import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as sharp from 'sharp';
import * as ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { promisify } from 'util';
import { StorageService } from '../storage/storage.service';

const unlinkAsync = promisify(fs.unlink);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly storageService: StorageService) {}

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

  public async processFile(
    file: Express.Multer.File,
    userId: string,
    destination?: string,
    idReference?: string,
    urlMedia?: string,
    type?: string,
  ): Promise<any> {
    let optimizedData: any = null;
    const directory = path.dirname(file.path);

    try {
      optimizedData = await this.optimizeFile(file);
      const minioDestination = destination || type || 'uploads';

      const minioUrls = await this.uploadToStorage(
        directory,
        minioDestination,
        file.filename,
        optimizedData,
      );

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
      // Only delete derived files (compressed, thumbnail, optimized) so Bull can retry
      // the job with the original file still present. Deleting the original here causes
      // "Input file is missing" on every retry attempt.
      await this.cleanupLocalFiles(directory, file.filename, optimizedData ?? {}, true);
      throw error;
    }
  }

  private async uploadToStorage(
    directory: string,
    destination: string,
    originalFilename: string,
    optimizedData: any,
  ): Promise<{ url: string; urlThumbnail: string; urlCompressed?: string; urlOptimized?: string }> {
    const urls: any = {};

    // Original upload is best-effort: large files (e.g. uncompressed PNGs) can exceed
    // the object-storage proxy's body-size limit. When it fails, the compressed variant
    // is used as the primary URL so the job still succeeds.
    const originalPath = path.join(directory, originalFilename);
    if (fs.existsSync(originalPath)) {
      try {
        const result = await this.storageService.uploadFile(originalPath, destination, originalFilename);
        urls.url = result.objectName;
      } catch (err) {
        const code = (err as any).code || 'no-code';
        this.logger.warn(
          `Original file upload failed (will use compressed as fallback): [${code}] ${err.message || '(no message)'}`,
        );
      }
    }

    if (optimizedData.thumbnail) {
      const thumbnailPath = path.join(directory, optimizedData.thumbnail);
      if (fs.existsSync(thumbnailPath)) {
        const result = await this.storageService.uploadFile(
          thumbnailPath,
          destination,
          optimizedData.thumbnail,
        );
        urls.urlThumbnail = result.objectName;
      }
    }

    if (optimizedData.compressed) {
      const compressedPath = path.join(directory, optimizedData.compressed);
      if (fs.existsSync(compressedPath)) {
        const result = await this.storageService.uploadFile(
          compressedPath,
          destination,
          optimizedData.compressed,
        );
        urls.urlCompressed = result.objectName;
      }
    }

    if (optimizedData.optimized) {
      const optimizedPath = path.join(directory, optimizedData.optimized);
      if (fs.existsSync(optimizedPath)) {
        const result = await this.storageService.uploadFile(
          optimizedPath,
          destination,
          optimizedData.optimized,
        );
        urls.urlOptimized = result.objectName;
      }
    }

    // Fallback chain for the primary URL:
    // 1. original (full quality)     — may be skipped for large files
    // 2. urlOptimized (transcoded video)
    // 3. urlCompressed (800 px image) — always available for images
    if (!urls.url && urls.urlOptimized) urls.url = urls.urlOptimized;
    if (!urls.url && urls.urlCompressed) urls.url = urls.urlCompressed;

    if (!urls.url) {
      throw new Error('No file variant could be uploaded to storage');
    }

    return urls;
  }

  private async cleanupLocalFiles(
    directory: string,
    originalFilename: string,
    optimizedData: any,
    preserveOriginal = false,
  ): Promise<void> {
    const filesToDelete = preserveOriginal ? [] : [originalFilename];

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

    throw new BadRequestException(`Unsupported file type: ${fileType}`);
  }

  private async optimizeImage(
    filePath: string,
  ): Promise<{ thumbnail: string; compressed: string }> {
    const directory = path.dirname(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext);

    // PNG lossless output is 5-10x larger than JPEG for photographic content.
    // Convert PNG derivatives to JPEG so they stay under the object-storage
    // proxy body-size limit. Other formats keep their original extension.
    const outputExt = ext === '.png' ? '.jpg' : ext;
    const compressedFilename = `compressed-${basename}${outputExt}`;
    const thumbnailFilename = `thumbnail-${basename}${outputExt}`;
    const compressedPath = path.join(directory, compressedFilename);
    const thumbnailPath = path.join(directory, thumbnailFilename);

    const base = sharp(filePath).rotate();
    const compressedPipe = base.clone().resize({ width: 800 });
    const thumbnailPipe = base.clone().resize({ width: 200 });

    if (ext === '.png') {
      await Promise.all([
        compressedPipe.jpeg({ quality: 85 }).toFile(compressedPath),
        thumbnailPipe.jpeg({ quality: 80 }).toFile(thumbnailPath),
      ]);
    } else {
      await Promise.all([
        compressedPipe.toFile(compressedPath),
        thumbnailPipe.toFile(thumbnailPath),
      ]);
    }

    return {
      compressed: compressedFilename,
      thumbnail: thumbnailFilename,
    };
  }

  private async optimizeVideo(
    filePath: string,
  ): Promise<{ optimized: string; thumbnail: string }> {
    const directory = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const optimizedPath = path.join(directory, `worky-${basename}.mp4`);
    const optimizedBasename = `worky-${basename}`;
    const thumbnailFilename = `thumbnail-${optimizedBasename}.jpg`;
    const thumbnailPath = path.join(directory, thumbnailFilename);

    // Transcode source to 720p MP4. The original file is deleted after a
    // successful transcode so disk space is not held for the duration of the
    // thumbnail step. On any error we clean up every file written so far so
    // the temp directory never accumulates orphaned artifacts.
    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(filePath)
          .outputOptions([
            '-c:v libx264',
            '-crf 23',
            '-preset fast',
            '-vf scale=-2:720',
            '-pix_fmt yuv420p',
          ])
          .output(optimizedPath)
          .on('end', () => resolve())
          .on('error', reject)
          .run();
      });

      // Remove original only after successful transcode.
      await unlinkAsync(filePath).catch((err) =>
        this.logger.warn(`Could not delete original video ${filePath}: ${err.message}`),
      );

      await this.generateVideoThumbnail(optimizedPath, directory, thumbnailFilename);

      return { optimized: `${optimizedBasename}.mp4`, thumbnail: thumbnailFilename };
    } catch (err) {
      // Clean up any files written before the error so the temp dir stays lean.
      for (const p of [optimizedPath, thumbnailPath]) {
        try {
          if (fs.existsSync(p)) await unlinkAsync(p);
        } catch {
          // best-effort; log nothing — original error is what matters
        }
      }
      throw err;
    }
  }

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
