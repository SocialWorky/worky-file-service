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
      // First, save the files and wait for successful confirmation
      const saveResponse = await this.saveFiles(
        payload.data,
        payload.urlMedia,
        payload.idReference,
        payload.type,
        payload.token,
      );

      // Verify that the save operation was successful
      // Only send notification if save was successful
      if (!saveResponse && payload.type !== TypePublishing.EMOJI) {
        throw new Error('Failed to save file data to database');
      }

      // Only send socket notification after successful save
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
          response: saveResponse,
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

        const messageResponse = await this.saveFileMessage(id, content, typeFile, urlFile, token);
        // Verify the message was saved successfully
        if (!messageResponse) {
          throw new Error('Failed to save message file');
        }
        return { content, typeFile, urlFile, messageResponse };
      } else {
        const mediaResponse = await this.saveUrlFile(
          saveLocation + filename,
          saveLocation + file.thumbnail,
          saveLocation + filenameCompressed,
          id,
          type,
          token,
        );
        // Return the response to verify it was saved successfully
        return mediaResponse;
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
    if (type === TypePublishing.EMOJI) return null;
    const body = {
      url: url,
      urlThumbnail: urlThumbnail,
      urlCompressed: urlCompressed,
      _idPublication: _idPublications,
      isPublications: type === TypePublishing.POST ? true : false,
      isComment: type === TypePublishing.COMMENT ? true : false,
    };

    const response = await this.http.axiosRef.post<any>(
      `${this.API_BACKEND_URL}/media/create`,
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    // Verify the response indicates success
    if (!response || !response.data) {
      throw new Error('Failed to save media file: Invalid response from backend');
    }

    return response.data;
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

      // Verify the response indicates success
      if (!response || !response.data) {
        throw new Error('Failed to save message file: Invalid response from messages service');
      }

      return response.data;
    } catch (error: any) {
      // Re-throw the error for proper error handling
      throw error;
    }
  }
}
