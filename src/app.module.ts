import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UploadController } from './upload/upload.controller';
import { UploadService } from './upload/upload.service';
import { AuthModule } from './auth/auth.module';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ConfigModule } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

import { UploadModule } from './upload/upload.module';
import { FileProcessingModule } from './file-processing/file-processing.module';
import { BullModule } from '@nestjs/bull';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Health module first for route priority - must be before AppController
    HealthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    BullModule.registerQueue({
      name: 'fileProcessing',
    }),
    BullBoardModule.forRoot({
      route: '/api/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'fileProcessing',
      adapter: BullAdapter,
    }),
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
            callback(new Error('Error creating destination directory'), null);
          }
        },
        filename: (req, file, callback) => {
          const { userId } = req.body;
          if (!userId) {
            return callback(new Error('userId is required'), null);
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const ext = extname(file.originalname);
          const basename = path.basename(file.originalname, ext);
          const cleanedBasename = basename.replace(/\s+/g, '');
          const filename = `${userId}-${timestamp}-${cleanedBasename}${ext}`;
          callback(null, filename);
        },
      }),
    }),
    UploadModule,
    FileProcessingModule,
  ],
  // Controllers order matters: HealthController (from HealthModule) is registered first
  // AppController is last to avoid intercepting /health routes
  controllers: [UploadController, AppController],
  providers: [AppService, UploadService],
})
export class AppModule {}
