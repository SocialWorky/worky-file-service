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
import { TypePublishing } from '../file-processing/notification.client';

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

    // If type is 'profileImg', process asynchronously but wait for the result
    if (body.type === TypePublishing.PROFILE_IMG) {
      const results = [];
      
      for (const file of files) {
        try {
          // Create a job and wait for it to finish
          const job = await this.fileProcessingQueue.add('fileProcessing', {
            file,
            userId: body.userId,
            destination: body.destination,
            idReference: body.idReference,
            urlMedia: body.urlMedia,
            type: body.type,
            token,
          });
          
          // Wait for the job to finish and get the result
          const result = await job.finished();
          
          // Verify that the result exists
          if (!result) {
            throw new BadRequestException('Could not process the file');
          }
          
          // The result will contain the processing result
          // Format the response as requested
          const formattedResult = {
            url: `${process.env.BASE_URL || 'http://localhost:3000'}uploads/${result.filename}`,
            urlThumbnail: `${process.env.BASE_URL || 'http://localhost:3000'}uploads/${result.thumbnail}`,
            urlCompressed: `${process.env.BASE_URL || 'http://localhost:3000'}uploads/${result.compressed}`,
            name: result.originalname,
            filename: result.filename,
          };
          
          results.push(formattedResult);
        } catch (error) {
          throw new BadRequestException(`Error processing file ${file.originalname}: ${error.message}`);
        }
      }

      return {
        message: 'Files processed successfully.',
        files: results,
      };
    }

    // For other types, use asynchronous processing with queue
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
      message: 'Files received. They will be processed in the background.',
    };
  }
}
