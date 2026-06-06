import {
  Controller,
  Post,
  Delete,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
  Body,
  BadRequestException,
  ForbiddenException,
  UseGuards,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { DedupService } from '../dedup/dedup.service';
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
    private readonly dedupService: DedupService,
    @InjectQueue('fileProcessing') private fileProcessingQueue: Queue,
  ) {}

  // Invalidate the dedup cache so re-uploading identical files re-processes them
  // (e.g. after changing the image pipeline). Optional ?destination=emojis scopes
  // the purge; omit it to clear everything. Admin-only — the role travels in the JWT.
  @UseGuards(JwtAuthGuard)
  @Delete('dedup-cache')
  async clearDedupCache(
    @Req() req: { user?: { role?: string } },
    @Query('destination') destination?: string,
  ): Promise<{ cleared: number; destination: string }> {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenException('Only admins can clear the cache');
    }
    const cleared = await this.dedupService.clear(destination?.trim() || undefined);
    return { cleared, destination: destination?.trim() || 'all' };
  }

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
            urlThumbnailWebP: result.urlThumbnailWebP,
            urlPreview: result.urlPreview,
            urlPreviewWebP: result.urlPreviewWebP,
            urlCompressed: result.urlCompressed,
            urlCompressedWebP: result.urlCompressedWebP,
            urlFull: result.urlFull,
            urlFullWebP: result.urlFullWebP,
            urlOptimized: result.urlOptimized,
            blurHash: result.blurHash,
            deduplicated: result.deduplicated ?? false,
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
      });
    }

    return {
      message: 'Files received. They will be processed in the background.',
    };
  }
}
