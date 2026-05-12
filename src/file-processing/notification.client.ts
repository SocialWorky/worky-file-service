import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';

export interface MediaFileUpload {
  filename: string;
  thumbnail: string;
  optimized?: string;
  compressed?: string;
  originalname?: string;
  // MinIO relative URLs (from uploadService.processFile)
  url?: string;
  urlThumbnail?: string;
  urlCompressed?: string;
  urlOptimized?: string;
}

export enum TypePublishing {
  ALL = 'all',
  POST = 'post',
  COMMENT = 'comment',
  POST_PROFILE = 'postProfile',
  IMAGE_VIEW = 'image-view',
  MESSAGE = 'message',
  EMOJI = 'emoji',
  PROFILE_IMG = 'profileImg',
}

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  FILE = 'file',
}

// Safety timeout: if some files fail all retries and never call sendNotification,
// dispatch whatever we have after this many ms to avoid the UI being stuck forever.
const BATCH_SAFETY_TIMEOUT_MS = 120_000;

interface BatchEntry {
  completed: number;
  total: number;
  latestPayload: {
    userId: string; title: string; body: string; data: any;
    urlMedia: string; type: TypePublishing; token: string;
  };
  safetyTimer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class NotificationClient {
  private readonly logger = new Logger(NotificationClient.name);

  private BASE_URL = process.env.BASE_URL;
  private NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL;
  private API_BACKEND_URL = process.env.API_BACKEND_URL;
  private API_MESSAGES_SERVICE_URL = process.env.API_MESSAGES_SERVICE_URL;

  // Per-publication completion tracking. Keyed by idReference.
  private readonly batches = new Map<string, BatchEntry>();

  constructor(private http: HttpService) {}

  // saveFiles (DB persist) and socketSend (UI update) are intentionally independent.
  // A DB failure must NOT block the socket notification.
  //
  // Multiple files in one upload share the same idReference. The upload controller stamps
  // totalFiles on every job so we can count completions and fire ONE socket notification
  // only when the last file finishes — regardless of per-file processing time.
  async sendNotification(payload: {
    userId: string;
    title: string;
    body: string;
    data: any;
    idReference: string;
    urlMedia: string;
    type: TypePublishing;
    token: string;
    totalFiles: number;
  }) {
    try {
      await this.saveFiles(
        payload.data,
        payload.urlMedia,
        payload.idReference,
        payload.type,
        payload.token,
      );
    } catch (error) {
      this.logger.error(
        `saveFiles failed for userId=${payload.userId} type=${payload.type}: ${error.message}`,
        error.stack,
      );
    }

    const { idReference, totalFiles } = payload;

    if (!this.batches.has(idReference)) {
      const safetyTimer = setTimeout(
        () => this.dispatchNotification(idReference),
        BATCH_SAFETY_TIMEOUT_MS,
      );
      this.batches.set(idReference, { completed: 0, total: totalFiles ?? 1, latestPayload: payload, safetyTimer });
    }

    const batch = this.batches.get(idReference)!;
    batch.completed += 1;
    batch.latestPayload = payload;

    this.logger.log(
      `File completed for idReference=${idReference}: ${batch.completed}/${batch.total}`,
    );

    if (batch.completed >= batch.total) {
      await this.dispatchNotification(idReference);
    }
  }

  private async dispatchNotification(idReference: string): Promise<void> {
    const batch = this.batches.get(idReference);
    if (!batch) return;

    clearTimeout(batch.safetyTimer);
    this.batches.delete(idReference);

    const { latestPayload: payload } = batch;
    this.logger.log(
      `Dispatching batched notification for idReference=${idReference} (${batch.completed}/${batch.total} files)`,
    );

    try {
      await this.http.axiosRef.post(
        `${this.NOTIFICATION_SERVICE_URL}/notifications/socketSend`,
        {
          userId: payload.userId,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          idReference,
          urlMedia: payload.urlMedia,
          type: payload.type,
        },
        {
          headers: { Authorization: `Bearer ${payload.token}` },
          timeout: 10000,
        },
      );
    } catch (error) {
      this.logger.error(
        `socketSend failed for userId=${payload.userId} type=${payload.type}: ${error.message}`,
        error.stack,
      );
    }
  }

  async saveFiles(
    response: MediaFileUpload,
    saveLocation: string,
    id: string,
    type: TypePublishing,
    token: string,
  ) {
    const file = response;
    let content = '';
    let typeFile: MessageType;

    if (type === TypePublishing.MESSAGE) {
      let urlFile = '';
      typeFile = MessageType.IMAGE;
      if (this.isVideoUrl(file.filename)) {
        typeFile = MessageType.VIDEO;
        const videoSaved = file.urlThumbnail || `messages/${file.thumbnail}`;
        urlFile = file.urlOptimized || file.url || `messages/${file.optimized || file.filename}`;
        content = `![Image](${videoSaved})`;
      } else {
        const imagenSaved = file.urlCompressed || file.url || `messages/${file.filename}`;
        urlFile = file.url || `messages/${file.filename}`;
        content = `![Image](${imagenSaved})`;
      }

      await this.saveFileMessage(id, content, typeFile, urlFile, token);
      return { content, typeFile, urlFile };
    } else {
      const url = file.url;
      const urlThumbnail = file.urlThumbnail;
      const urlCompressed = this.isVideoUrl(file.filename)
        ? file.urlOptimized || file.url
        : file.urlCompressed || file.url;

      await this.saveUrlFile(url, urlThumbnail, urlCompressed, id, type, token);
    }
  }

  isVideoUrl(url: string): boolean {
    return /\.(mp4|ogg|webm|avi|mov)$/i.test(url);
  }

  async saveUrlFile(
    url: string,
    urlThumbnail: string,
    urlCompressed: string,
    _idPublications: string,
    type: TypePublishing,
    token: string,
  ) {
    if (type === TypePublishing.EMOJI) return;
    const body = {
      url: url,
      urlThumbnail: urlThumbnail,
      urlCompressed: urlCompressed,
      _idPublication: _idPublications,
      isPublications: type === TypePublishing.POST ? true : false,
      isComment: type === TypePublishing.COMMENT ? true : false,
    };

    return await this.http.axiosRef.post<any>(
      `${this.API_BACKEND_URL}/media/create`,
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      },
    );
  }

  async saveFileMessage(idMessage, content, type, urlFile, token) {
    const response = await this.http.axiosRef.put<any>(
      `${this.API_MESSAGES_SERVICE_URL}/messages/${idMessage}`,
      { content, type, urlFile },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      },
    );
    return response.data;
  }
}
