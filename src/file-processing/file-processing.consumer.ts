import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { UploadService } from '../upload/upload.service';
import { NotificationClient } from './notification.client';

@Processor('fileProcessing')
export class FileProcessingConsumer {
  constructor(
    private readonly uploadService: UploadService,
    private readonly notificationClient: NotificationClient,
  ) {}

  @Process('fileProcessing')
  async processJob(job: Job<any>) {
    const { file, userId, idReference, urlMedia, type, token } = job.data;

    try {
      // Pass all parameters to processFile so files are stored in correct MinIO folder
      const result = await this.uploadService.processFile(
        file,
        userId,
        idReference,
        urlMedia,
        type,
      );

      // If type is profileImg, return the result directly
      if (type === 'profileImg') {
        // Use moveToCompleted so the controller can get the result
        await job.moveToCompleted(result, undefined, true);
        return result;
      }

      // For other types, send notification as before
      await this.notificationClient.sendNotification({
        userId,
        title: 'File processed',
        body: `Your file ${result.originalname} is ready.`,
        data: result,
        idReference,
        urlMedia,
        type,
        token,
      });
    } catch (error) {
      throw error; // Re-throw the error so the controller can catch it
    }
  }
}
