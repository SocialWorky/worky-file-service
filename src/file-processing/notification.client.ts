import { Injectable } from '@nestjs/common';
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

@Injectable()
export class NotificationClient {
  private BASE_URL = process.env.BASE_URL;
  private NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL;
  private API_BACKEND_URL = process.env.API_BACKEND_URL;
  private API_MESSAGES_SERVICE_URL = process.env.API_MESSAGES_SERVICE_URL;

  constructor(private http: HttpService) {}

  async sendNotification(payload: {
    userId: string;
    title: string;
    body: string;
    data: any;
    idReference: string;
    urlMedia: string;
    type: TypePublishing;
    token: string;
  }) {
    try {
      const response = await this.saveFiles(
        payload.data,
        payload.urlMedia,
        payload.idReference,
        payload.type,
        payload.token,
      );

      await this.http.axiosRef.post(
        `${this.NOTIFICATION_SERVICE_URL}/notifications/socketSend`,
        {
          userId: payload.userId,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          idReference: payload.idReference,
          urlMedia: payload.urlMedia,
          type: payload.type,
          response,
        },
        {
          headers: {
            Authorization: `Bearer ${payload.token}`,
          },
        },
      );
    } catch (error) {
      // Re-throw the error to allow the caller to handle it.
      // Notification errors should be handled by the caller.
      throw error;
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
    try {
      let content = '';
      let typeFile: MessageType;

      if (type === TypePublishing.MESSAGE) {
        let urlFile = '';
        typeFile = MessageType.IMAGE;
        if (this.isVideoUrl(file.filename)) {
          typeFile = MessageType.VIDEO;
          // Use relative paths from MinIO (file.urlThumbnail and file.urlOptimized are already relative)
          // These come from uploadService.processFile which returns MinIO relative paths
          const videoSaved = file.urlThumbnail || `messages/${file.thumbnail}`;
          urlFile = file.urlOptimized || file.url || `messages/${file.optimized || file.filename}`;
          // For markdown content, use the thumbnail URL (relative path)
          content = `![Image](${videoSaved})`;
        } else {
          // Use relative paths from MinIO (file.url is already relative like "messages/filename.jpg")
          // Prefer urlCompressed for display, fallback to url, then construct from filename
          const imagenSaved = file.urlCompressed || file.url || `messages/${file.filename}`;
          urlFile = file.url || `messages/${file.filename}`;
          content = `![Image](${imagenSaved})`;
        }

        await this.saveFileMessage(id, content, typeFile, urlFile, token);
        return { content, typeFile, urlFile };
      } else {
        // Use MinIO relative URLs directly instead of constructing URLs with saveLocation
        // uploadService.processFile returns relative MinIO paths like "comment/filename.jpg"
        const url = file.url;
        const urlThumbnail = file.urlThumbnail;
        const urlCompressed = this.isVideoUrl(file.filename)
          ? file.urlOptimized || file.url
          : file.urlCompressed || file.url;

        await this.saveUrlFile(
          url,
          urlThumbnail,
          urlCompressed,
          id,
          type,
          token,
        );
      }
    } catch (error) {
      // Re-throw the error to allow the caller to handle it.
      // Swallowing this error can lead to data inconsistencies.
      throw error;
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
      },
    );
  }

  async saveFileMessage(idMessage, content, type, urlFile, token) {
    try {
      const response = await this.http.axiosRef.put<any>(
        `${this.API_MESSAGES_SERVICE_URL}/messages/${idMessage}`,
        {
          content: content,
          type: type,
          urlFile: urlFile,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      return response.data;
    } catch (error: any) {
      // Re-throw the error for proper error handling
      throw error;
    }
  }
}
