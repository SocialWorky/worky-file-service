import { Processor, Process, OnQueueFailed, OnQueueActive, OnQueueStalled } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { UploadService } from '../upload/upload.service';
import { NotificationClient } from './notification.client';
import { MetricsService } from '../metrics/metrics.service';

const IMAGE_JOB_TIMEOUT_MS = 120_000;
const VIDEO_JOB_TIMEOUT_MS = 300_000;

@Processor('fileProcessing')
export class FileProcessingConsumer {
  private readonly logger = new Logger(FileProcessingConsumer.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly notificationClient: NotificationClient,
    private readonly metricsService: MetricsService,
  ) {}

  @OnQueueActive()
  onJobActive(job: Job<any>): void {
    this.logger.log(JSON.stringify({
      event: 'job_started',
      jobId: job.id,
      queue: 'fileProcessing',
      userId: job.data?.userId,
      fileType: job.data?.type,
      attemptsMade: job.attemptsMade,
    }));
  }

  @OnQueueStalled()
  onJobStalled(job: Job<any>): void {
    this.logger.warn(JSON.stringify({
      event: 'job_stalled',
      jobId: job.id,
      queue: 'fileProcessing',
      userId: job.data?.userId,
      fileType: job.data?.type,
    }));
  }

  @Process({ name: 'fileProcessing', concurrency: 3 })
  async processJob(job: Job<any>) {
    const { file, userId, destination, idReference, urlMedia, type, token, totalFiles } = job.data;
    const startTime = Date.now();
    const isVideo = file?.mimetype?.startsWith('video/');
    const timeoutMs = isVideo ? VIDEO_JOB_TIMEOUT_MS : IMAGE_JOB_TIMEOUT_MS;

    let result: any;
    try {
      result = await Promise.race([
        this.uploadService.processFile(file, userId, destination, idReference, urlMedia, type),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('JOB_TIMEOUT')), timeoutMs),
        ),
      ]);
    } catch (error) {
      throw error;
    }

    const durationMs = Date.now() - startTime;
    this.metricsService.recordSuccess(type ?? 'unknown', durationMs, file?.size ?? 0, result?.deduplicated ?? false);
    this.logger.log(JSON.stringify({
      event: 'job_completed',
      jobId: job.id,
      userId,
      type,
      destination,
      durationMs,
      inputBytes: file?.size ?? 0,
      deduplicated: result?.deduplicated ?? false,
      variants: Object.keys(result ?? {}).filter((k) => k.startsWith('url')),
    }));

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
  }

  @OnQueueFailed()
  onJobFailed(job: Job<any>, error: Error): void {
    const durationMs = job.processedOn ? Date.now() - job.processedOn : 0;
    const e = error as any;

    this.metricsService.recordFailure(job.data?.type ?? 'unknown', durationMs);
    this.logger.error(JSON.stringify({
      event: 'job_failed',
      jobId: job.id,
      userId: job.data?.userId,
      type: job.data?.type,
      destination: job.data?.destination,
      errorCode: e.code ?? 'no-code',
      errorMessage: error.message,
      attempt: job.attemptsMade,
      durationMs,
    }));
  }
}
