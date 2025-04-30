import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as sharp from 'sharp';
import * as ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
//import * as ffmpegPath from '@ffmpeg-installer/ffmpeg';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { promisify } from 'util';

const unlinkAsync = promisify(fs.unlink);
//ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
@Injectable()
export class UploadService {
  /**
   * Procesa la subida de múltiples archivos.
   * @param files Los archivos a subir.
   * @param userId El ID del usuario que sube los archivos.
   * @returns Una promesa que resuelve con un array de resultados de procesamiento de archivos.
   */
  async uploadFiles(
    files: Express.Multer.File[],
    userId: string,
  ): Promise<any[]> {
    const results = [];

    for (const file of files) {
      try {
        const result = await this.processFile(file, userId);
        results.push(result);
      } catch (error) {
        console.error(`Error processing file ${file.originalname}:`, error);
        results.push({
          originalname: file.originalname,
          filename: file.filename,
          error: error.message,
          userId,
        });
      }
    }

    return results;
  }

  /**
   * Procesa un solo archivo, optimizándolo según su tipo.
   * @param file El archivo a procesar.
   * @param userId El ID del usuario que sube el archivo.
   * @returns Una promesa que resuelve con un objeto que contiene información del archivo procesado.
   * @throws Error si ocurre algún problema durante el procesamiento del archivo.
   */
  private async processFile(
    file: Express.Multer.File,
    userId: string,
  ): Promise<any> {
    try {
      const optimizedData = await this.optimizeFile(file);
      return {
        originalname: file.originalname,
        filename: file.filename,
        ...optimizedData,
        userId,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Optimiza un archivo según su tipo (imagen o video).
   * @param file El archivo a optimizar.
   * @returns Una promesa que resuelve con un objeto que contiene información del archivo optimizado.
   * @throws Error si el tipo de archivo no es soportado.
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
   * Optimiza una imagen, creando una versión comprimida y una miniatura.
   * @param filePath La ruta del archivo de imagen.
   * @returns Una promesa que resuelve con un objeto que contiene las rutas de la imagen comprimida y la miniatura.
   * @throws Error si ocurre algún problema durante la optimización de la imagen.
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
      console.error(`Error optimizing image ${filePath}: ${error.message}`);
      throw error;
    }

    return { compressed: compressedPath, thumbnail: thumbnailPath };
  }

  /**
   * Optimiza un video, creando una versión optimizada más pequeña y una miniatura.
   * @param filePath La ruta del archivo de video.
   * @returns Una promesa que resuelve con un objeto que contiene la ruta del video optimizado y la miniatura.
   * @throws Error si ocurre algún problema durante la optimización del video.
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
          '-vf scale=-2:720', // 👈 Sin comillas
          '-pix_fmt yuv420p',
        ])
        .output(optimizedPath)
        .on('end', async () => {
          try {
            await unlinkAsync(filePath); // Elimina el video original

            // Genera la miniatura
            await this.generateVideoThumbnail(optimizedPath);

            resolve({
              optimized: `worky|${basename}.mp4`,
              thumbnail: `thumbnail|worky|${basename}.jpg`,
            });
          } catch (unlinkError) {
            console.error('Error deleting original video:', unlinkError);
            reject(unlinkError);
          }
        })
        .on('error', (err) => {
          console.error('Error optimizing video:', err.message);
          reject(err);
        })
        .run();
    });
  }

  /**
   * Extrae un fotograma del video para usarlo como miniatura.
   * @param filePath Ruta del archivo de video.
   * @returns Una promesa que resuelve con la ruta de la miniatura.
   * @throws Error si ocurre un problema durante la extracción.
   */
  private async generateVideoThumbnail(filePath: string): Promise<string> {
    const directory = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext); // <- AHORA SÍ SE USA!
    const thumbnailPath = path.join(directory, `thumbnail|${basename}.jpg`);

    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .on('end', () => {
          if (fs.existsSync(thumbnailPath)) {
            resolve(thumbnailPath);
          } else {
            reject(new Error('Miniatura no generada.'));
          }
        })
        .on('error', (err) => {
          console.error('Error generando miniatura:', err.message);
          reject(err);
        })
        .screenshots({
          count: 1,
          folder: directory,
          filename: `thumbnail|${basename}.jpg`,
          size: '320x240',
          timemarks: ['00:00:01'],
        });
    });
  }
}
