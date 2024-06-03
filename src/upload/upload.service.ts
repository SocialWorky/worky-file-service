import { Injectable } from '@nestjs/common';

@Injectable()
export class UploadService {
  uploadFiles(files: Express.MulterFile[], userId: string) {
    const response = files.map((file) => ({
      originalname: file.originalname,
      filename: file.filename,
      path: file.path,
      userId: userId,
    }));
    return response;
  }
}
