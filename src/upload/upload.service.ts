import { Injectable } from '@nestjs/common';
import { fork } from 'child_process';
import * as path from 'path';

@Injectable()
export class UploadService {
  async uploadFiles(files: Express.Multer.File[], userId: string) {
    const response = await Promise.all(
      files.map(async (file) => {
        try {
          await this.optimizeFileInWorker(file);
          const fileType = file.mimetype.split('/')[0];

          return {
            originalname: file.originalname,
            filename: file.filename,
            fileType,
            userId,
          };
        } catch (error) {
          return {
            originalname: file.originalname,
            filename: file.filename,
            error: error.message,
            userId,
          };
        }
      }),
    );
    return response;
  }

  private optimizeFileInWorker(file: Express.Multer.File): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = fork(path.join(__dirname, 'file-worker.js'));

      worker.send({
        filePath: file.path,
        fileType: file.mimetype.split('/')[0],
      });
      worker.on('message', (msg: { success?: boolean; error?: string }) => {
        if (msg.success) {
          resolve();
        } else {
          reject(new Error(msg.error));
        }
      });

      worker.on('error', (error) => reject(error));
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }
}
