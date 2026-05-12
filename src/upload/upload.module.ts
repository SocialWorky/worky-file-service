import { Module } from '@nestjs/common';

import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { AuthModule } from '../auth/auth.module';
import { FileProcessingModule } from '../file-processing/file-processing.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuthModule, FileProcessingModule, StorageModule],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
