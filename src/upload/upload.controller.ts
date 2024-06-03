import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

class UploadDto {
  userId: string;
}

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseInterceptors(FilesInterceptor('files', 10)) // Permite subir hasta 10 archivos
  uploadFiles(
    @UploadedFiles() files: Express.MulterFile[],
    @Body() body: UploadDto,
  ) {
    return this.uploadService.uploadFiles(files, body.userId);
  }
}
