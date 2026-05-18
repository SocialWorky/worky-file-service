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
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const ALLOWED_DESTINATIONS = new Set([
  'worky_default',
  // publication media
  'publications',
  'publication',
  // comment media
  'comments',
  'comment',
  // profile images
  'profileImg',
  'profile-avatar',
  'profile',
  // messages/chat media
  'messages',
  'message',
  // custom emojis/reactions
  'emojis',
  'emoji',
  // thematic images (admin)
  'thematic-images',
  'thematic-image',
  'thematic',
  // widgets (admin)
  'widgets',
  'widget',
  // stories (ephemeral content)
  'stories',
  'story',
  // config / misc
  'config',
  'post',
  'postProfile',
  'image-view',
  'all',
]);

function sanitizeDestination(raw: string | undefined): string {
  if (!raw) return 'worky_default';
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  return ALLOWED_DESTINATIONS.has(cleaned) ? cleaned : 'worky_default';
}

function sanitizeUserId(raw: string | undefined): string | null {
  if (!raw) return null;
  // Allow only alphanumeric, hyphens, and underscores (UUID-safe)
  const cleaned = raw.toString().replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned.length > 0 && cleaned.length <= 128 ? cleaned : null;
}

import { UploadModule } from './upload/upload.module';
import { FileProcessingModule } from './file-processing/file-processing.module';
import { DedupModule } from './dedup/dedup.module';
import { MetricsModule } from './metrics/metrics.module';
import { BullModule } from '@nestjs/bull';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { HealthModule } from './health/health.module';
import { MinioModule } from './minio/minio.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    HealthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    MinioModule,
    StorageModule,
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
      limits: {
        fileSize: 100 * 1024 * 1024,
        files: 10,
      },
      storage: diskStorage({
        destination: (req, file, callback) => {
          try {
            const safeDestination = sanitizeDestination(req.body?.destination);
            const uploadPath = path.join(
              __dirname,
              '..',
              'uploads',
              safeDestination,
            );

            const uploadsRoot = path.resolve(path.join(__dirname, '..', 'uploads'));
            const resolved = path.resolve(uploadPath);
            if (!resolved.startsWith(uploadsRoot + path.sep) && resolved !== uploadsRoot) {
              return callback(new Error('Invalid upload destination'), null);
            }

            fs.mkdirSync(uploadPath, { recursive: true });
            callback(null, uploadPath);
          } catch (err) {
            callback(new Error('Error creating destination directory'), null);
          }
        },
        filename: (req, file, callback) => {
          const rawUserId = req.body?.userId;
          const cleanUserId = sanitizeUserId(rawUserId) || 'unknown';
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const nonce = crypto.randomBytes(4).toString('hex');
          const ext = extname(file.originalname) || '.bin';
          callback(null, `${cleanUserId}-${timestamp}-${nonce}${ext}`);
        },
      }),
    }),
    UploadModule,
    FileProcessingModule,
    DedupModule,
    MetricsModule,
  ],
  controllers: [UploadController, AppController],
  providers: [AppService, UploadService],
})
export class AppModule {}
