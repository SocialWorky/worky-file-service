import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class FileTypeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const files = request.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      throw new BadRequestException('No files have been uploaded.');
    }

    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'video/mp4',
      'video/mpeg',
    ];

    for (const file of files) {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        throw new BadRequestException(
          `File type not allowed: ${file.originalname}`,
        );
      }
    }

    return next.handle();
  }
}
