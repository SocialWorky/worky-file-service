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
import { FileTypeInterceptor } from './file-type.interceptor';

class UploadDto {
  userId: string;
  destination: string;
}

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(FilesInterceptor('files', 10), FileTypeInterceptor)
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: UploadDto,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'No files have been uploaded or the files are not of the allowed type.',
      );
    }

    try {
      const response = await this.uploadService.uploadFiles(files, body.userId);
      return response;
    } catch (error) {
      throw new BadRequestException(`Error processing files: ${error.message}`);
    }
  }
}
