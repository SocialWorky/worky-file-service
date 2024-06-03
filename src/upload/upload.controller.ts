import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  Body,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class UploadDto {
  userId: string;
  destination: string;
}

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(FilesInterceptor('files', 10))
  uploadFiles(
    @UploadedFiles() files: Express.MulterFile[],
    @Body() body: UploadDto,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'No se han subido archivos o los archivos no son del tipo permitido.',
      );
    }
    return this.uploadService.uploadFiles(files, body.userId);
  }
}
