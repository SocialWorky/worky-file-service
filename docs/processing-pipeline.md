# Processing Pipeline — worky-file-service

## Image Pipeline

1. Multer writes the raw file to `uploads/<destination>/` on local disk.
2. `FileTypeInterceptor` reads the first 16 bytes and validates magic bytes. Files that fail are deleted and a `400` is returned.
3. A Bull job is queued. `FileProcessingConsumer` picks it up.
4. `UploadService.optimizeImage()` runs two Sharp passes:
   - **Compressed** — max width 800px, EXIF auto-rotation. Prefix: `compressed-`
   - **Thumbnail** — max width 200px, EXIF auto-rotation. Prefix: `thumbnail-`
5. Original + compressed + thumbnail are uploaded to storage under `<destination>/`.
6. All three local temp files are deleted.
7. `NotificationClient` saves metadata to the main API and broadcasts via WebSocket.

## Video Pipeline

1–3. Same as image (Multer write, magic bytes check, queue).
4. `UploadService.optimizeVideo()` runs FFmpeg:
   - Transcode to H.264 (libx264), CRF 23, preset fast, scale to 720p (`scale=-2:720`), pixel format `yuv420p`.
   - Output: `worky-<original>.mp4`.
5. JPEG thumbnail extracted at 1-second mark (320×240) via a second FFmpeg pass.
6. Optimized MP4 + thumbnail uploaded to storage.
7. Both local files are deleted.
8. `NotificationClient` notifies the message service (chat media) or main API (post media) and broadcasts via WebSocket.

## Profile Image Exception (Synchronous)

When `type=profileImg`, the upload controller calls `job.finished()` and waits up to **30 seconds** for the result before responding. The response body includes `url`, `urlThumbnail`, and `urlCompressed` paths.

## Queue Configuration

| Setting | Value |
|---|---|
| Queue name | `fileProcessing` |
| Concurrency | 3 jobs / 1000ms |
| Retry attempts | 3 |
| Retry backoff | Exponential, starting at 2000ms |
| Completed job retention | 100 most recent |
| Failed job retention | 50 most recent |

## Supported File Types

### Images

| MIME | Extensions | Magic bytes |
|---|---|---|
| `image/jpeg` | `.jpg` `.jpeg` | `FF D8 FF` |
| `image/png` | `.png` | `89 50 4E 47 0D 0A 1A 0A` |
| `image/gif` | `.gif` | `47 49 46 38` |
| `image/bmp` | `.bmp` | `42 4D` |
| `image/tiff` | `.tiff` `.tif` | `49 49 2A 00` or `4D 4D 00 2A` |
| `image/webp` | `.webp` | `52 49 46 46 ... 57 45 42 50` |

### Videos

| MIME | Extensions | Detection |
|---|---|---|
| `video/mp4` | `.mp4` | `ftyp` box at byte 4 |
| `video/mpeg` | `.mpeg` `.mpg` | `00 00 01 B3` or `00 00 01 BA` |
| `video/quicktime` | `.mov` | Declared MIME |
| `video/avi` | `.avi` | `52 49 46 46 ... 41 56 49 20` |

## Storage Providers

### MinIO (default — `STORAGE_PROVIDER=minio`)

Self-hosted S3-compatible store. Bucket is created automatically at startup with a public-read policy. CORS must be configured at the MinIO server level via Console or `mc` CLI.

### AWS S3 (`STORAGE_PROVIDER=s3`)

Opt-in. Requires installing the AWS SDK separately:

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

The S3 provider does **not** auto-create the bucket — create it manually before deploying.

### Adding a New Provider

Implement the `IStorageProvider` interface at `src/storage/interfaces/storage-provider.interface.ts` (6 methods: `ensureBucket`, `uploadFile`, `uploadBuffer`, `deleteFile`, `getPublicUrl`, `getPresignedUrl`), then register in `StorageService` with a new `case` in the constructor switch and set `STORAGE_PROVIDER=<name>`.
