import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { UploadService } from '../upload/upload.service';
import { NotificationClient } from './notification.client';

@Processor('fileProcessing')
export class FileProcessingConsumer {
  private readonly logger = new Logger(FileProcessingConsumer.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly notificationClient: NotificationClient,
  ) {}

  @Process('fileProcessing')
  async processJob(job: Job<any>) {
    const { file, userId, destination, idReference, urlMedia, type, token, totalFiles } = job.data;

    try {
      const result = await this.uploadService.processFile(
        file,
        userId,
        destination,
        idReference,
        urlMedia,
        type,
      );

      if (type === 'profileImg') {
        await job.moveToCompleted(result, undefined, true);
        return result;
      }

      await this.notificationClient.sendNotification({
        userId,
        title: 'File processed',
        body: `Your file ${result.originalname} is ready.`,
        data: result,
        idReference,
        urlMedia,
        type,
        token,
        totalFiles: totalFiles ?? 1,
      });
    } catch (error) {
      throw error;
    }
  }

  @OnQueueFailed()
  onJobFailed(job: Job<any>, error: Error): void {
    const e = error as any;
    const errMsg = [
      e.code ? `[${e.code}]` : '[no-code]',
      error.message || '(no message)',
      e.resource ? `resource=${e.resource}` : '',
      e.amzRequestid ? `requestId=${e.amzRequestid}` : '',
    ].filter(Boolean).join(' ');
    this.logger.error(
      `Job ${job.id} (${job.name}) failed after ${job.attemptsMade} attempt(s). ` +
      `userId=${job.data?.userId} type=${job.data?.type} destination=${job.data?.destination}. ` +
      `Error: ${errMsg}`,
      error.stack,
    );
  }
}
