import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  Body,
  BadRequestException,
  UseGuards,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileTypeInterceptor } from './file-type.interceptor';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { TypePublishing } from '../file-processing/notification.client';

// JwtAuthGuard (passport-jwt) already verifies the token cryptographically before the
// handler runs. A second call to validateToken() here was redundant and added attack
// surface (it read process.env.JWT_SECRET inline and never used the returned user).
// The raw token is still extracted here only to forward it to downstream services.

@Controller('upload')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
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
    // authHeader has already been validated by JwtAuthGuard; we only need the raw value
    // to forward to downstream services (connect-service, backend).
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization header missing or malformed');
    }
    const token = authHeader.slice(7);

    if (!files || files.length === 0) {
      throw new BadRequestException(
        'No files have been uploaded or the files are not of the allowed type.',
      );
    }

    if (body.type === TypePublishing.PROFILE_IMG) {
      const results = [];

      for (const file of files) {
        try {
          const job = await this.fileProcessingQueue.add('fileProcessing', {
            file,
            userId: body.userId,
            destination: body.destination,
            idReference: body.idReference,
            urlMedia: body.urlMedia,
            type: body.type,
            token,
          }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 50,
          });
          
          const JOB_TIMEOUT_MS = 30_000;
          const result = await Promise.race([
            job.finished(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('File processing timed out after 30s')),
                JOB_TIMEOUT_MS,
              ),
            ),
          ]);
          
          if (!result) {
            throw new BadRequestException('Could not process the file');
          }
          
          const formattedResult = {
            url: result.url,
            urlThumbnail: result.urlThumbnail,
            urlCompressed: result.urlCompressed,
            urlOptimized: result.urlOptimized,
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

    const totalFiles = files.length;
    for (const file of files) {
      await this.fileProcessingQueue.add('fileProcessing', {
        file,
        userId: body.userId,
        destination: body.destination,
        idReference: body.idReference,
        urlMedia: body.urlMedia,
        type: body.type,
        token,
        totalFiles,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      });
    }

    return {
      message: 'Files received. They will be processed in the background.',
    };
  }
}
