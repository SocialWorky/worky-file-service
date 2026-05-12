import { Module } from '@nestjs/common';

import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { AuthModule } from '../auth/auth.module';
import { FileProcessingModule } from '../file-processing/file-processing.module';
import { StorageModule } from '../storage/storage.module';
import { DedupModule } from '../dedup/dedup.module';

@Module({
  imports: [AuthModule, FileProcessingModule, StorageModule, DedupModule],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
