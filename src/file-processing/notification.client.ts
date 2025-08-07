import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';

export interface MediaFileUpload {
  filename: string;
  thumbnail: string;
  optimized?: string;
  compressed?: string;
  originalname?: string;
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
      // Silent fail for notification errors
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
      const filename = this.isVideoUrl(file.filename)
        ? file.optimized!
        : file.filename;
      const filenameCompressed = this.isVideoUrl(file.filename)
        ? file.optimized!
        : file.compressed!;

      let content = '';
      let typeFile: MessageType;

      if (type === TypePublishing.MESSAGE) {
        let urlFile = '';
        typeFile = MessageType.IMAGE;
        if (this.isVideoUrl(file.filename)) {
          typeFile = MessageType.VIDEO;
          const videoSaved = this.BASE_URL + 'messages/' + file.thumbnail;
          urlFile = this.BASE_URL + 'messages/' + file.optimized;
          content = `![Image](${videoSaved})`;
        } else {
          const imagenSaved = this.BASE_URL + 'messages/' + file.filename;
          urlFile = this.BASE_URL + 'messages/' + file.filename;
          content = `![Image](${imagenSaved})`;
        }

        await this.saveFileMessage(id, content, typeFile, urlFile, token);
        return { content, typeFile, urlFile };
      } else {
        await this.saveUrlFile(
          saveLocation + filename,
          saveLocation + file.thumbnail,
          saveLocation + filenameCompressed,
          id,
          type,
          token,
        );
      }
    } catch (error) {
      // Silent fail for file saving errors
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
