import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as sharp from 'sharp';
import * as ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as ffmpegPath from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegPath.path);

@Injectable()
export class UploadService {
  async uploadFiles(files: Express.Multer.File[], userId: string) {
    const response = await Promise.all(
      files.map(async (file) => {
        try {
          await this.optimizeFile(file);

          const fileType = file.mimetype.split('/')[0];

          const nameFile = file.filename + '|' + file.originalname;

          if (fileType === 'image') {
            return {
              originalname: file.originalname,
              filename: nameFile,
              filenameThumbnail: 'thumbnail|' + nameFile,
              filenameCompressed: 'compressed|' + nameFile,
              userId: userId,
            };
          } else if (fileType === 'video') {
            return {
              originalname: file.originalname,
              filename: 'worky|' + nameFile,
              filenameThumbnail: 'worky|' + nameFile,
              filenameCompressed: 'worky|' + nameFile,
              userId: userId,
            };
          }
        } catch (error) {
          console.error(
            `Error processing file ${file.originalname}: ${error.message}`,
          );
          // Handle or log the error appropriately
          return {
            originalname: file.originalname,
            filename: file.filename + '|' + file.originalname,
            filenameThumbnail:
              'thumbnail|' + file.filename + '|' + file.originalname,
            filenameCompressed:
              'compressed|' + file.filename + '|' + file.originalname,
            error: error.message,
            userId: userId,
          };
        }
      }),
    );
    return response;
  }

  private async optimizeFile(
    file: Express.Multer.File,
  ): Promise<
    { compressed: string; thumbnail: string } | { optimized: string }
  > {
    const filePath = file.path;
    const fileType = file.mimetype.split('/')[0];

    if (fileType === 'image') {
      return this.optimizeImage(filePath);
    } else if (fileType === 'video') {
      return this.optimizeVideo(filePath);
    }
    return null;
  }

  private async optimizeImage(
    filePath: string,
  ): Promise<{ compressed: string; thumbnail: string }> {
    const directory = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);

    const compressedPath = path.join(directory, `compressed|${basename}${ext}`);
    const thumbnailPath = path.join(directory, `thumbnail|${basename}${ext}`);

    try {
      // Crear una versión comprimida
      await sharp(filePath)
        .rotate() // Respetar la orientación original
        .resize({ width: 800 }) // Cambiar el tamaño según lo necesites
        .toFile(compressedPath);

      // Crear una versión de menor tamaño
      await sharp(filePath)
        .rotate() // Respetar la orientación original
        .resize({ width: 200 }) // Cambiar el tamaño según lo necesites
        .toFile(thumbnailPath);
    } catch (error) {
      console.error(`Error optimizing image ${filePath}: ${error.message}`);
      throw error;
    }

    return {
      compressed: compressedPath,
      thumbnail: thumbnailPath,
    };
  }

  private optimizeVideo(filePath: string): Promise<{ optimized: string }> {
    const directory = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);

    const optimizedPath = path.join(directory, `worky|${basename}.mp4`);

    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .outputOptions([
          '-c:v libx264', // Codec de video
          '-crf 23', // Constant Rate Factor (calidad vs tamaño)
          '-preset fast', // Preset de velocidad de codificación
          '-vf "scale=-2:720"', // Escalar manteniendo la relación de aspecto
          '-pix_fmt yuv420p', // Formato de píxeles para compatibilidad amplia
        ])
        .output(optimizedPath)
        .on('end', () => {
          fs.unlinkSync(filePath);

          resolve({ optimized: optimizedPath });
        })
        .on('error', (err) => {
          console.error('Error optimizing video:', err);
          reject(err);
        })
        .run();
    });
  }
}
