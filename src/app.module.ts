// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UploadController } from './upload/upload.controller';
import { UploadService } from './upload/upload.service';
import { AuthModule } from './auth/auth.module';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import * as path from 'path';

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, callback) => {
          try {
            const { destination } = req.body;
            const uploadPath = path.join(
              __dirname,
              '..',
              'uploads',
              destination || 'worky_default',
            );

            fs.mkdirSync(uploadPath, { recursive: true });
            callback(null, uploadPath);
          } catch (err) {
            callback(new Error('Error creando directorio de destino'), null);
          }
        },
        filename: (req, file, callback) => {
          const { userId } = req.body;
          if (!userId) {
            return callback(new Error('userId is required'), null);
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const ext = extname(file.originalname);
          const filename = `${userId}-${timestamp}${ext}`;
          callback(null, filename);
        },
      }),
    }),
    AuthModule,
  ],
  controllers: [AppController, UploadController],
  providers: [AppService, UploadService],
})
export class AppModule {}
