import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as sharp from 'sharp';
import * as ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { encode as encodeBlurHash } from 'blurhash';
import { StorageService } from '../storage/storage.service';
import { DedupService } from '../dedup/dedup.service';

const unlinkAsync = promisify(fs.unlink);
const execFileAsync = promisify(execFile);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// ffprobe ships alongside ffmpeg in @ffmpeg-installer/ffmpeg
const ffprobePath = (ffmpegInstaller as any).path.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

const BRIGHTNESS_THRESHOLD = 10;

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly dedupService: DedupService,
  ) {}

  async uploadFiles(
    files: Express.Multer.File[],
    userId: string,
    destination?: string,
    idReference?: string,
    urlMedia?: string,
    type?: string,
  ): Promise<any[]> {
    const results = [];

    for (const file of files) {
      try {
        const result = await this.processFile(
          file,
          userId,
          destination,
          idReference,
          urlMedia,
          type,
        );
        results.push(result);
      } catch (error) {
        results.push({
          originalname: file.originalname,
          filename: file.filename,
          error: error.message,
          userId,
          destination,
          idReference,
          urlMedia,
          type,
        });
      }
    }

    return results;
  }

  public async processFile(
    file: Express.Multer.File,
    userId: string,
    destination?: string,
    idReference?: string,
    urlMedia?: string,
    type?: string,
  ): Promise<any> {
    let optimizedData: any = null;
    const directory = path.dirname(file.path);
    const minioDestination = destination || type || 'uploads';

    try {
      // Deduplication check: if same bytes were already processed to the same destination,
      // skip the entire pipeline and return cached URLs immediately.
      const hash = await this.dedupService.computeHash(file.path);
      const cached = await this.dedupService.getCached(hash, minioDestination);
      if (cached) {
        await unlinkAsync(file.path).catch(() => undefined);
        return { ...cached, deduplicated: true };
      }

      optimizedData = await this.optimizeFile(file);

      const minioUrls = await this.uploadToStorage(
        directory,
        minioDestination,
        file.filename,
        optimizedData,
      );

      await this.cleanupLocalFiles(directory, file.filename, optimizedData);

      const result = {
        originalname: file.originalname,
        filename: file.filename,
        ...optimizedData,
        ...minioUrls,
        userId,
        idReference,
        urlMedia,
        type,
        deduplicated: false,
      };

      await this.dedupService.setCached(hash, minioDestination, result);
      return result;
    } catch (error) {
      this.logger.error(`Error processing file: ${error.message}`);
      // Only delete derived files (compressed, thumbnail, optimized) so Bull can retry
      // the job with the original file still present. Deleting the original here causes
      // "Input file is missing" on every retry attempt.
      await this.cleanupLocalFiles(directory, file.filename, optimizedData ?? {}, true);
      throw error;
    }
  }

  private async uploadToStorage(
    directory: string,
    destination: string,
    originalFilename: string,
    optimizedData: any,
  ): Promise<any> {
    const urls: any = {};

    // Original upload is best-effort: large files (e.g. uncompressed PNGs) can exceed
    // the object-storage proxy's body-size limit. When it fails, the compressed variant
    // is used as the primary URL so the job still succeeds.
    const originalPath = path.join(directory, originalFilename);
    if (fs.existsSync(originalPath)) {
      try {
        const result = await this.storageService.uploadFile(originalPath, destination, originalFilename);
        urls.url = result.objectName;
      } catch (err) {
        const code = (err as any).code || 'no-code';
        this.logger.warn(
          `Original file upload failed (will use compressed as fallback): [${code}] ${err.message || '(no message)'}`,
        );
      }
    }

    const variantMap: Array<[string, string]> = [
      ['thumbnail',       'urlThumbnail'],
      ['thumbnailWebp',   'urlThumbnailWebP'],
      ['preview',         'urlPreview'],
      ['previewWebp',     'urlPreviewWebP'],
      ['compressed',      'urlCompressed'],
      ['compressedWebp',  'urlCompressedWebP'],
      ['full',            'urlFull'],
      ['fullWebp',        'urlFullWebP'],
      ['optimized',       'urlOptimized'],
    ];

    for (const [field, urlKey] of variantMap) {
      if (optimizedData[field]) {
        const filePath = path.join(directory, optimizedData[field]);
        if (fs.existsSync(filePath)) {
          const result = await this.storageService.uploadFile(filePath, destination, optimizedData[field]);
          urls[urlKey] = result.objectName;
        }
      }
    }

    // Fallback chain for the primary URL:
    // 1. original (full quality)     — may be skipped for large files
    // 2. urlOptimized (transcoded video)
    // 3. urlFull / urlCompressed (image) — always available for images
    if (!urls.url && urls.urlOptimized) urls.url = urls.urlOptimized;
    if (!urls.url && urls.urlFull) urls.url = urls.urlFull;
    if (!urls.url && urls.urlCompressed) urls.url = urls.urlCompressed;

    if (!urls.url) {
      throw new Error('No file variant could be uploaded to storage');
    }

    return urls;
  }

  private async cleanupLocalFiles(
    directory: string,
    originalFilename: string,
    optimizedData: any,
    preserveOriginal = false,
  ): Promise<void> {
    const filesToDelete = preserveOriginal ? [] : [originalFilename];

    const variantFields = [
      'thumbnail', 'thumbnailWebp',
      'preview', 'previewWebp',
      'compressed', 'compressedWebp',
      'full', 'fullWebp',
      'optimized',
    ];

    for (const field of variantFields) {
      if (optimizedData[field]) filesToDelete.push(optimizedData[field]);
    }

    for (const fileName of filesToDelete) {
      const filePath = path.join(directory, fileName);
      try {
        if (fs.existsSync(filePath)) {
          await unlinkAsync(filePath);
          this.logger.log(`Deleted local file: ${filePath}`);
        }
      } catch (error) {
        this.logger.warn(`Could not delete file ${filePath}: ${error.message}`);
      }
    }
  }

  private async optimizeFile(
    file: Express.Multer.File,
  ): Promise<
    | { thumbnail: string; compressed: string }
    | { optimized: string; thumbnail?: string }
  > {
    const filePath = file.path;
    const fileType = file.mimetype.split('/')[0];

    if (fileType === 'image') {
      return this.optimizeImage(filePath);
    } else if (fileType === 'video') {
      return this.optimizeVideo(filePath);
    }

    throw new BadRequestException(`Unsupported file type: ${fileType}`);
  }

  private async optimizeImage(filePath: string): Promise<{
    thumbnail: string; thumbnailWebp: string;
    preview: string; previewWebp: string;
    compressed: string; compressedWebp: string;
    full: string; fullWebp: string;
    blurHash: string;
  }> {
    const meta = await sharp(filePath).metadata();
    if ((meta.width ?? 0) * (meta.height ?? 0) > 100_000_000) {
      throw new BadRequestException('Image dimensions too large (max 100MP)');
    }

    const directory = path.dirname(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext);

    // All derivatives output as JPEG + WebP regardless of input format.
    // Sharp strips EXIF by default (withMetadata() is intentionally not called).
    // .rotate() bakes EXIF orientation into pixels — privacy safe.
    // withoutEnlargement: true prevents upscaling smaller source images.
    // Animated GIF: Sharp extracts only the first frame when converting to JPEG/WebP.
    // This is intentional — static thumbnails are generated; animations are not preserved.
    const names = {
      thumbnail:    `thumbnail-${basename}.jpg`,
      thumbnailWebp:`thumbnail-${basename}.webp`,
      preview:      `preview-${basename}.jpg`,
      previewWebp:  `preview-${basename}.webp`,
      compressed:   `compressed-${basename}.jpg`,
      compressedWebp:`compressed-${basename}.webp`,
      full:         `full-${basename}.jpg`,
      fullWebp:     `full-${basename}.webp`,
    };

    const p = (name: string) => path.join(directory, name);
    const base = sharp(filePath).rotate();

    const [, , , , , , , , blurHashBuffer] = await Promise.all([
      base.clone().resize({ width: 200,  withoutEnlargement: true }).jpeg({ quality: 80, progressive: true }).toFile(p(names.thumbnail)),
      base.clone().resize({ width: 200,  withoutEnlargement: true }).webp({ quality: 77 }).toFile(p(names.thumbnailWebp)),
      base.clone().resize({ width: 400,  withoutEnlargement: true }).jpeg({ quality: 82, progressive: true }).toFile(p(names.preview)),
      base.clone().resize({ width: 400,  withoutEnlargement: true }).webp({ quality: 79 }).toFile(p(names.previewWebp)),
      base.clone().resize({ width: 800,  withoutEnlargement: true }).jpeg({ quality: 85, progressive: true }).toFile(p(names.compressed)),
      base.clone().resize({ width: 800,  withoutEnlargement: true }).webp({ quality: 82 }).toFile(p(names.compressedWebp)),
      base.clone().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 88, progressive: true }).toFile(p(names.full)),
      base.clone().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 85 }).toFile(p(names.fullWebp)),
      // 32x32 raw RGBA used for BlurHash — tiny dimensions are intentional
      base.clone().resize(32, 32, { fit: 'fill' }).raw().ensureAlpha().toBuffer(),
    ]);

    const blurHash = encodeBlurHash(new Uint8ClampedArray(blurHashBuffer), 32, 32, 4, 3);
    return { ...names, blurHash };
  }

  private async optimizeVideo(
    filePath: string,
  ): Promise<{ optimized: string; thumbnail: string }> {
    const directory = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const optimizedPath = path.join(directory, `worky-${basename}.mp4`);
    const optimizedBasename = `worky-${basename}`;
    const thumbnailFilename = `thumbnail-${optimizedBasename}.jpg`;
    const thumbnailPath = path.join(directory, thumbnailFilename);

    // Transcode source to 720p MP4. The original file is deleted after a
    // successful transcode so disk space is not held for the duration of the
    // thumbnail step. On any error we clean up every file written so far so
    // the temp directory never accumulates orphaned artifacts.
    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(filePath)
          .outputOptions([
            '-c:v libx264',
            '-crf 23',
            '-preset fast',
            '-vf scale=-2:720',
            '-pix_fmt yuv420p',
          ])
          .output(optimizedPath)
          .on('end', () => resolve())
          .on('error', reject)
          .run();
      });

      // Remove original only after successful transcode.
      await unlinkAsync(filePath).catch((err) =>
        this.logger.warn(`Could not delete original video ${filePath}: ${err.message}`),
      );

      const duration = await this.getVideoDuration(optimizedPath);
      await this.generateVideoThumbnail(optimizedPath, directory, thumbnailFilename, duration);

      return { optimized: `${optimizedBasename}.mp4`, thumbnail: thumbnailFilename };
    } catch (err) {
      // Clean up any files written before the error so the temp dir stays lean.
      for (const p of [optimizedPath, thumbnailPath]) {
        try {
          if (fs.existsSync(p)) await unlinkAsync(p);
        } catch {
          // best-effort; log nothing — original error is what matters
        }
      }
      throw err;
    }
  }

  private async getVideoDuration(filePath: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        filePath,
      ]);
      const duration = parseFloat(stdout.trim());
      return isNaN(duration) ? 0 : duration;
    } catch {
      return 0;
    }
  }

  private async findBestVideoFrame(filePath: string, duration: number): Promise<number> {
    const safeMax = duration > 0 ? duration - 0.1 : 1;
    const candidates = [1, 3, 5, duration * 0.10, duration * 0.25]
      .map((t) => Math.min(t, safeMax))
      .filter((t) => t > 0);

    // Deduplicate timestamps
    const unique = [...new Set(candidates.map((t) => Math.round(t * 100) / 100))];

    for (const ts of unique) {
      const tmpFile = `${filePath}-probe-${ts}.jpg`;
      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(filePath)
            .screenshots({ count: 1, folder: path.dirname(tmpFile), filename: path.basename(tmpFile), timemarks: [String(ts)] })
            .on('end', () => resolve())
            .on('error', reject);
        });

        if (fs.existsSync(tmpFile)) {
          const stats = await sharp(tmpFile).stats();
          await unlinkAsync(tmpFile).catch(() => undefined);
          // stats.channels[0] is the red/luma channel; mean > threshold means not a black frame
          if (stats.channels[0].mean > BRIGHTNESS_THRESHOLD) {
            return ts;
          }
        }
      } catch {
        await unlinkAsync(tmpFile).catch(() => undefined);
      }
    }

    // All candidates were dark — fall back to 20% of duration
    return duration > 0 ? Math.min(duration * 0.20, safeMax) : 1;
  }

  private async generateVideoThumbnail(filePath: string, outputDir: string, thumbnailFilename: string, duration: number): Promise<string> {
    const thumbnailPath = path.join(outputDir, thumbnailFilename);
    const bestTs = await this.findBestVideoFrame(filePath, duration);

    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .screenshots({
          count: 1,
          folder: outputDir,
          filename: thumbnailFilename,
          size: '640x360',
          timemarks: [String(bestTs)],
        })
        .on('end', () => {
          if (fs.existsSync(thumbnailPath)) {
            resolve(thumbnailFilename);
          } else {
            reject(new Error('Thumbnail not generated'));
          }
        })
        .on('error', reject);
    });
  }
}
