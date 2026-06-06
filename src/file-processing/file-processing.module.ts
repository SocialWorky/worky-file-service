import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { FileProcessingConsumer } from './file-processing.consumer';
import { NotificationClient } from './notification.client';
import { UploadService } from '../upload/upload.service';
import { HttpModule } from '@nestjs/axios';
import { StorageModule } from '../storage/storage.module';
import { DedupModule } from '../dedup/dedup.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'fileProcessing',
      limiter: { max: 3, duration: 1000 },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
    HttpModule,
    StorageModule,
    DedupModule,
    MetricsModule,
  ],
  providers: [FileProcessingConsumer, NotificationClient, UploadService],
  exports: [FileProcessingConsumer, BullModule],
})
export class FileProcessingModule {}
