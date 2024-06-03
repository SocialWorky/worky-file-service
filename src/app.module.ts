import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UploadController } from './upload/upload.controller';
import { UploadService } from './upload/upload.service';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, callback) => {
          const userId = req.body.userId || 'unknown';

          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const ext = extname(file.originalname);
          const filename = `${userId}-${timestamp}${ext}`;

          callback(null, filename);
        },
      }),
    }),
  ],
  controllers: [AppController, UploadController],
  providers: [AppService, UploadService],
})
export class AppModule {}
