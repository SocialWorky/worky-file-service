import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { FileProcessingConsumer } from './file-processing.consumer';
import { NotificationClient } from './notification.client';
import { UploadService } from '../upload/upload.service';
import { HttpModule } from '@nestjs/axios';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'fileProcessing',
      limiter: { max: 3, duration: 1000 },
    }),
    HttpModule,
    StorageModule,
  ],
  providers: [FileProcessingConsumer, NotificationClient, UploadService],
  exports: [FileProcessingConsumer, BullModule],
})
export class FileProcessingModule {}
