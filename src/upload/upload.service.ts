import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { Worker } from 'worker_threads';

@Injectable()
export class UploadService {
  async uploadFiles(files: Express.Multer.File[], userId: string) {
    const response = await Promise.all(
      files.map(async (file) => {
        try {
          await this.optimizeFile(file);
          const fileType = file.mimetype.split('/')[0];

          if (fileType === 'image') {
            return {
              originalname: file.originalname,
              filename: file.filename,
              filenameThumbnail: 'thumbnail|' + file.filename,
              filenameCompressed: 'compressed|' + file.filename,
              userId: userId,
            };
          } else if (fileType === 'video') {
            return {
              originalname: file.originalname,
              filename: 'worky|' + file.filename,
              filenameThumbnail: 'worky|' + file.filename,
              filenameCompressed: 'worky|' + file.filename,
              userId: userId,
            };
          }
        } catch (error) {
          console.error(
            `Error processing file ${file.originalname}: ${error.message}`,
          );
          return {
            originalname: file.originalname,
            filename: file.filename,
            filenameThumbnail: 'thumbnail|' + file.filename,
            filenameCompressed: 'compressed|' + file.filename,
            error: error.message,
            userId: userId,
          };
        }
      }),
    );
    return response;
  }

  private async optimizeFile(file: Express.Multer.File): Promise<void> {
    const filePath = file.path;
    const fileType = file.mimetype.split('/')[0];

    if (fileType === 'image') {
      await this.runWorker('optimizeImage', filePath);
    } else if (fileType === 'video') {
      await this.runWorker('optimizeVideo', filePath);
    }
  }

  private async runWorker(task: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.resolve(__dirname, 'file-worker.js'));

      worker.postMessage({ task, filePath });

      worker.on('message', (result) => {
        console.log(result);
        resolve();
      });

      worker.on('error', (error) => {
        console.error('Worker error:', error);
        reject(error);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Worker stopped with exit code ${code}`);
        }
      });
    });
  }
}
