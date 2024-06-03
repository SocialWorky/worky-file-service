import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UploadController } from './upload/upload.controller';
import { UploadService } from './upload/upload.service';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import * as path from 'path';

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, callback) => {
          const { destination } = req.body;
          const uploadPath = path.join(
            __dirname,
            '..',
            'uploads',
            destination || 'worky_default',
          );

          fs.mkdirSync(uploadPath, { recursive: true });
          callback(null, uploadPath);
        },
        filename: (req, file, callback) => {
          const { userId } = req.body;
          if (!userId) {
            return callback(new Error('userId es requerido'), null);
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const ext = extname(file.originalname);
          const filename = `${userId}-${timestamp}${ext}`;
          callback(null, filename);
        },
      }),
      fileFilter: (req, file, callback) => {
        const allowedMimeTypes = [
          'image/jpeg',
          'image/png',
          'video/mp4',
          'video/mpeg',
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
          callback(null, true);
        } else {
          callback(new Error('Tipo de archivo no permitido'), false);
        }
      },
    }),
  ],
  controllers: [AppController, UploadController],
  providers: [AppService, UploadService],
})
export class AppModule {}
