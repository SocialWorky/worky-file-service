import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  Body,
  BadRequestException,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileTypeInterceptor } from './file-type.interceptor';
import { AuthService } from 'src/auth/auth.service';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';

@Controller('upload')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private _authService: AuthService,
    @InjectQueue('fileProcessing') private fileProcessingQueue: Queue,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(FilesInterceptor('files', 10), FileTypeInterceptor)
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Headers('authorization') authHeader: string,
    @Body()
    body: {
      userId: string;
      destination: string;
      idReference?: string;
      urlMedia?: string;
      type?: string;
    },
  ) {
    const token = authHeader.split(' ')[1];
    const user = this._authService.validateToken(token);

    if (!user) {
      throw new BadRequestException('Invalid token');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException(
        'No files have been uploaded or the files are not of the allowed type.',
      );
    }

    for (const file of files) {
      await this.fileProcessingQueue.add('fileProcessing', {
        file,
        userId: body.userId,
        destination: body.destination,
        idReference: body.idReference,
        urlMedia: body.urlMedia,
        type: body.type,
        token,
      });
    }

    return {
      message: 'Archivos recibidos. Se procesarán en segundo plano.',
    };
  }
}
