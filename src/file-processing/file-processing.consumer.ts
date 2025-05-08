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
      const result = await this.uploadService.processFile(file, userId);
      await this.notificationClient.sendNotification({
        userId,
        title: 'Archivo procesado',
        body: `Tu archivo ${result.originalname} está listo.`,
        data: result,
        idReference,
        urlMedia,
        type,
        token,
      });
    } catch (error) {
      console.error(
        `[JOB ERROR] Error procesando archivo: ${file.originalname}`,
      );
      console.error(error.message);
    }
  }
}
