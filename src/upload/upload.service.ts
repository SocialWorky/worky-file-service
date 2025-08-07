import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as sharp from 'sharp';
import * as ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { promisify } from 'util';

const unlinkAsync = promisify(fs.unlink);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
@Injectable()
export class UploadService {
  /**
   * Processes the upload of multiple files.
   * @param files The files to upload.
   * @param userId The ID of the user uploading the files.
   * @returns A promise that resolves with an array of file processing results.
   */
  async uploadFiles(
    files: Express.Multer.File[],
    userId: string,
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
          idReference,
          urlMedia,
          type,
        });
      }
    }

    return results;
  }

  /**
   * Processes a single file, optimizing it according to its type.
   * @param file The file to process.
   * @param userId The ID of the user uploading the file.
   * @returns A promise that resolves with an object containing processed file information.
   * @throws Error if any problem occurs during file processing.
   */
  public async processFile(
    file: Express.Multer.File,
    userId: string,
    idReference?: string,
    urlMedia?: string,
    type?: string,
  ): Promise<any> {
    try {
      const optimizedData = await this.optimizeFile(file);
      return {
        originalname: file.originalname,
        filename: file.filename,
        ...optimizedData,
        userId,
        idReference,
        urlMedia,
        type,
      };
    } catch (error) {
      throw error;
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

    const compressedPath = path.join(directory, `compressed|${basename}${ext}`);
    const thumbnailPath = path.join(directory, `thumbnail|${basename}${ext}`);

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

    return {
      compressed: `compressed|${basename}${ext}`,
      thumbnail: `thumbnail|${basename}${ext}`,
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
    const optimizedPath = path.join(directory, `worky|${basename}.mp4`);

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

            await this.generateVideoThumbnail(optimizedPath);

            resolve({
              optimized: `worky|${basename}.mp4`,
              thumbnail: `thumbnail|worky|${basename}.jpg`,
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
  private async generateVideoThumbnail(filePath: string): Promise<string> {
    const directory = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const thumbnailPath = path.join(directory, `thumbnail|${basename}.jpg`);

    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .screenshots({
          count: 1,
          folder: directory,
          filename: `thumbnail|${basename}.jpg`,
          size: '320x240',
          timemarks: ['00:00:01'],
        })
        .on('end', () => {
          if (fs.existsSync(thumbnailPath)) {
            resolve(thumbnailPath);
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
