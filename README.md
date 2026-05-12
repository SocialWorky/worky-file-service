# worky-file-service

Central file upload and processing service for the social network. All media — images and videos — from every client (web, mobile) must flow through this service before reaching storage. Direct uploads to MinIO or S3 from clients are not permitted.

Version: **2.1.0** | Runtime: **Node.js 22** | Framework: **NestJS 10**

---

## 1. Overview

`worky-file-service` receives multipart file uploads, validates them against known MIME magic bytes, queues them for async processing via Bull/Redis, runs optimization (Sharp for images, FFmpeg for videos), uploads all variants to object storage, and notifies the rest of the platform when files are ready.

It is the single point of truth for all media assets. The main API and message service never touch raw files; they receive object-storage paths from this service after processing is complete.

---

## 2. Architecture

### Component diagram

```
Client (Angular / React Native)
        |
        | POST /upload  (multipart/form-data, Bearer token)
        v
+------------------+
|  UploadController |  <-- JwtAuthGuard + FileTypeInterceptor (magic bytes)
+------------------+
        |
        | add job to Bull queue
        v
+--------------------+      Redis (Bull broker)
|  fileProcessing    |  <--------------------------+
|     queue          |                             |
+--------------------+                             |
        |                                          |
        | FileProcessingConsumer                   |
        v                                          |
+------------------+                              |
|  UploadService   |  (Sharp / FFmpeg)            |
+------------------+                              |
        |                                          |
        | uploadFile()                             |
        v                                          |
+------------------+                              |
|  StorageService  |  -- selects provider at boot -+
+------------------+
        |              |
        v              v
  MinioProvider    S3Provider
  (default)        (opt-in via STORAGE_PROVIDER=s3)
        |
        v
  Object storage  (bucket: social-network-files)
        |
        v
  NotificationClient
        |
        +-- POST {API_BACKEND_URL}/media/create          (images/videos for posts & comments)
        +-- PUT  {API_MESSAGES_SERVICE_URL}/messages/:id (chat media)
        +-- POST {NOTIFICATION_SERVICE_URL}/notifications/socketSend (WebSocket broadcast)
```

### Profile image exception (synchronous path)

When `type=profileImg`, the controller calls `job.finished()` and waits up to 30 seconds for the result before responding to the client. All other upload types return immediately with a `202`-style acknowledgement and continue processing in the background.

---

## 3. API Reference

### POST /upload

Uploads one or more files. Requires a valid JWT.

**Auth**: `Authorization: Bearer <token>`

**Content-Type**: `multipart/form-data`

**Limits**: 10 files per request, 100 MB per file.

#### Form fields

| Field | Required | Description |
|-------|----------|-------------|
| `files` | Yes | One or more files (field name must be `files`) |
| `userId` | Yes | ID of the user performing the upload |
| `destination` | Yes | Storage sub-directory (e.g. `posts`, `messages`, `profileImg`) |
| `type` | No | Upload context — see `TypePublishing` enum below |
| `idReference` | No | ID of the entity the file is attached to (publication, comment, message) |
| `urlMedia` | No | Save location hint passed through to `NotificationClient` |

#### TypePublishing enum

| Value | Meaning |
|-------|---------|
| `profileImg` | Profile picture — processed synchronously, result returned in response |
| `post` | Publication attachment |
| `comment` | Comment attachment |
| `postProfile` | Profile feed post |
| `image-view` | Standalone image viewer |
| `message` | Chat message attachment |
| `emoji` | Custom emoji upload |
| `all` | Generic / uncategorised |

#### Response — async path (all types except `profileImg`)

```json
{
  "message": "Files received. They will be processed in the background."
}
```

HTTP status: `201`

#### Response — sync path (`type=profileImg`)

```json
{
  "message": "Files processed successfully.",
  "files": [
    {
      "url": "profileImg/userId-2024-01-15T10-30-00-000Z-photo.jpg",
      "urlThumbnail": "profileImg/thumbnail-userId-2024-01-15T10-30-00-000Z-photo.jpg",
      "urlCompressed": "profileImg/compressed-userId-2024-01-15T10-30-00-000Z-photo.jpg",
      "urlOptimized": null,
      "name": "photo.jpg",
      "filename": "userId-2024-01-15T10-30-00-000Z-photo.jpg"
    }
  ]
}
```

The URL values are storage object paths relative to the bucket root. Callers must prepend `MINIO_PUBLIC_URL/<bucket>/` (or the equivalent S3 public URL) to construct a full URL.

#### Example request (curl)

```bash
curl -X POST http://localhost:3005/upload \
  -H "Authorization: Bearer <jwt>" \
  -F "files=@/path/to/image.jpg" \
  -F "userId=abc123" \
  -F "destination=posts" \
  -F "type=post" \
  -F "idReference=pub-uuid-here"
```

#### Error responses

| Status | Cause |
|--------|-------|
| `400` | No files provided, unsupported MIME type, magic bytes mismatch, missing `userId`, processing timeout (profileImg only) |
| `401` | Missing or invalid JWT |

---

## 4. Storage Providers

The active provider is selected at startup via the `STORAGE_PROVIDER` environment variable. Switching providers requires a restart.

### MinIO (default — `STORAGE_PROVIDER=minio`)

Self-hosted S3-compatible object store. The bucket is created automatically on startup if it does not exist. A public read policy (`s3:GetObject`) is applied to the bucket automatically so processed files are accessible without authentication.

CORS on MinIO must be configured at the server level via the MinIO Console or `mc` CLI — it cannot be set through the SDK.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MINIO_ENDPOINT` | No | `localhost` | MinIO server hostname or IP |
| `MINIO_PORT` | No | `9000` | MinIO API port |
| `MINIO_USE_SSL` | No | `false` | Set to `true` when MinIO is behind HTTPS |
| `MINIO_ACCESS_KEY` | Yes (prod) | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | Yes (prod) | `minioadmin123` | MinIO secret key |
| `MINIO_BUCKET` | No | `social-network-files` | Target bucket name |
| `MINIO_PUBLIC_URL` | No | `http://localhost:9000` | Base URL used to construct public file URLs |

### AWS S3 (`STORAGE_PROVIDER=s3`)

The S3 provider is available but requires installing the AWS SDK separately — it is not in `package.json` by default to avoid the dependency in environments that only use MinIO.

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

The S3 provider does not auto-create the bucket. Create it manually via the AWS Console or CLI before deploying.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AWS_REGION` | Yes | `us-east-1` | AWS region |
| `AWS_S3_BUCKET` | Yes | `social-network-files` | S3 bucket name |
| `AWS_ACCESS_KEY_ID` | Yes | — | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | — | AWS secret key |
| `AWS_S3_PUBLIC_URL` | No | `https://<bucket>.s3.<region>.amazonaws.com` | Override public URL (for CloudFront or custom domain) |

---

## 5. Processing Pipeline

### Image pipeline

1. Multer writes the raw file to `uploads/<destination>/` on local disk.
2. `FileTypeInterceptor` reads the first 16 bytes and validates magic bytes. Files that fail are deleted immediately and a `400` is returned.
3. A Bull job is queued. `FileProcessingConsumer` picks it up.
4. `UploadService.optimizeImage()` runs two Sharp passes:
   - **Compressed variant** — resize to max width 800 px, EXIF auto-rotation applied. Filename prefix: `compressed-`.
   - **Thumbnail variant** — resize to max width 200 px, EXIF auto-rotation applied. Filename prefix: `thumbnail-`.
5. Original + compressed + thumbnail are uploaded to storage under `<destination>/`.
6. All three local files are deleted.
7. `NotificationClient` saves metadata to the main API and broadcasts via WebSocket.

### Video pipeline

1–3. Same as image (Multer write, magic bytes check, queue).
4. `UploadService.optimizeVideo()` runs FFmpeg:
   - Transcodes to H.264 (libx264), CRF 23, preset fast, scale to 720p height (`scale=-2:720`), pixel format `yuv420p`.
   - Output filename: `worky-<original>.mp4`.
   - The source file is deleted immediately after FFmpeg finishes.
5. A JPEG thumbnail is extracted at the 1-second mark (320×240) using a second FFmpeg pass.
6. Optimised MP4 + thumbnail uploaded to storage.
7. Both local files are deleted.
8. `NotificationClient` saves to the message service (for chat) or main API (for posts) and broadcasts via WebSocket.

### Queue configuration

| Setting | Value |
|---------|-------|
| Queue name | `fileProcessing` |
| Job concurrency | 3 jobs / 1000 ms (rate limiter) |
| Retry attempts | 3 |
| Retry backoff | Exponential, starting at 2000 ms |
| Completed job retention | 100 most recent |
| Failed job retention | 50 most recent |

---

## 6. Environment Variables

Complete reference. All sensitive values must be stored in Kubernetes Secrets — never in ConfigMaps or committed `.env` files.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_PORT` | No | `3005` | HTTP listen port |
| `JWT_SECRET` | Yes | — | HS256 secret shared across all services |
| `REDIS_HOST` | Yes | — | Redis hostname for Bull queue |
| `REDIS_PORT` | No | `6379` | Redis port |
| `REDIS_PASSWORD` | No | — | Redis password (omit if no auth) |
| `STORAGE_PROVIDER` | No | `minio` | `minio` or `s3` |
| `MINIO_ENDPOINT` | No | `localhost` | MinIO hostname |
| `MINIO_PORT` | No | `9000` | MinIO port |
| `MINIO_USE_SSL` | No | `false` | `true` / `false` |
| `MINIO_ACCESS_KEY` | Yes (prod) | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | Yes (prod) | `minioadmin123` | MinIO secret key |
| `MINIO_BUCKET` | No | `social-network-files` | Storage bucket |
| `MINIO_PUBLIC_URL` | No | `http://localhost:9000` | Public base URL for file links |
| `AWS_REGION` | S3 only | `us-east-1` | AWS region |
| `AWS_S3_BUCKET` | S3 only | `social-network-files` | S3 bucket |
| `AWS_ACCESS_KEY_ID` | S3 only | — | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | S3 only | — | AWS secret key |
| `AWS_S3_PUBLIC_URL` | No | auto | Override S3 public URL |
| `API_BACKEND_URL` | Yes | — | Base URL of `SocialNetwork-backend-app` (e.g. `http://backend-svc`) |
| `NOTIFICATION_SERVICE_URL` | Yes | — | Base URL of `worky-connect-service` (e.g. `http://connect-svc:3010`) |
| `API_MESSAGES_SERVICE_URL` | Yes | — | Base URL of `worky-message-service` (e.g. `http://message-svc:3003`) |
| `BASE_URL` | No | `http://localhost:3005` | Public base URL of this service (used in log messages) |
| `CORS_ORIGINS` | No | — | Comma-separated allowed origins. Omitting this allows all localhost origins in non-production. |
| `NODE_ENV` | No | — | Set to `production` to enable strict CORS and Content Security Policy |
| `NAMESPACE` / `KUBERNETES_NAMESPACE` | No | — | Kubernetes namespace, used to detect dev/staging environment automatically |

---

## 7. Running Locally

### Prerequisites

- Node.js 22
- npm
- Docker (for MinIO and Redis)
- libvips (required by Sharp)
- FFmpeg

```bash
# macOS
brew install libvips ffmpeg

# Debian/Ubuntu
apt-get install libvips-dev ffmpeg
```

### Step 1 — Start infrastructure

```bash
# From worky-file-service/
docker run -d --name worky-minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin123 \
  quay.io/minio/minio server /data --console-address ":9001"

docker run -d --name worky-redis -p 6379:6379 redis:7
```

MinIO Console is available at `http://localhost:9001` (user: `minioadmin`, password: `minioadmin123`).

### Step 2 — Configure environment

Create a `.env` file in `worky-file-service/` (not committed to version control):

```env
APP_PORT=3005
JWT_SECRET=your-dev-secret-here

REDIS_HOST=localhost
REDIS_PORT=6379

MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET=social-network-files
MINIO_PUBLIC_URL=http://localhost:9000

API_BACKEND_URL=http://localhost:3001
NOTIFICATION_SERVICE_URL=http://localhost:3010
API_MESSAGES_SERVICE_URL=http://localhost:3003

NODE_ENV=development
```

### Step 3 — Install and run

```bash
npm install
npm run start:dev
```

The service starts on `http://localhost:3005`. Bull Board (queue monitor) is at `http://localhost:3005/api/queues`.

### Using Docker Compose

```bash
# Copy and edit the compose file
cp docker-compose-worky.dev.yml .env  # configure variables
docker-compose -f docker-compose-worky.dev.yml up
```

---

## 8. Kubernetes Deployment

**Namespace**: `social-network-dev`
**Kubernetes secret name**: `file-service-env-vars`

All environment variables listed in Section 6 must be present in the `file-service-env-vars` Secret. The deployment reads them via `envFrom.secretRef`.

```bash
# Create or update the secret
kubectl create secret generic file-service-env-vars \
  --from-env-file=.env.production \
  -n social-network-dev \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Resources

| Resource | Request | Limit |
|----------|---------|-------|
| Memory | 256 Mi | 1 Gi |
| CPU | 500 m | 1 core |

### PersistentVolumeClaim

The deployment mounts a 10 Gi `ReadWriteOnce` PVC (`files-pvc`, StorageClass: `longhorn`) at `/app/uploads`. This is the transient staging directory for files awaiting processing. Files are deleted after successful upload to storage.

Because the PVC is `ReadWriteOnce`, the deployment strategy is `Recreate` (not `RollingUpdate`). Zero-downtime deploys are not possible with this volume type.

### Health check endpoints

| Endpoint | Probe type | Initial delay | Period |
|----------|-----------|---------------|--------|
| `GET /health` | General | — | — |
| `GET /health/live` | Liveness | 30 s | 10 s |
| `GET /health/ready` | Readiness | 10 s | 5 s |

All three return `{ "status": "ok", "timestamp": "<ISO 8601>" }`.

### Kubernetes service

Internal ClusterIP service name: `file-service-svc` (port 80 → 3005).

---

## 9. File Type Support

### Images

| MIME type | Extensions | Magic bytes (hex) |
|-----------|-----------|-------------------|
| `image/jpeg` | `.jpg`, `.jpeg` | `FF D8 FF` |
| `image/png` | `.png` | `89 50 4E 47 0D 0A 1A 0A` |
| `image/gif` | `.gif` | `47 49 46 38` |
| `image/bmp` | `.bmp` | `42 4D` |
| `image/tiff` | `.tiff`, `.tif` | `49 49 2A 00` (LE) or `4D 4D 00 2A` (BE) |
| `image/webp` | `.webp` | `52 49 46 46 ?? ?? ?? ?? 57 45 42 50` |

### Videos

| MIME type | Extensions | Detection |
|-----------|-----------|-----------|
| `video/mp4` | `.mp4` | `ftyp` box at byte 4 |
| `video/mpeg` | `.mpeg`, `.mpg` | `00 00 01 B3` or `00 00 01 BA` |
| `video/quicktime` | `.mov` | Declared MIME (no distinct magic bytes) |
| `video/avi` | `.avi` | `52 49 46 46 ?? ?? ?? ?? 41 56 49 20` |

Files whose declared `Content-Type` does not match the magic bytes of the stored bytes are rejected and deleted before any processing occurs.

---

## 10. Adding a New Storage Provider

The `IStorageProvider` interface at `src/storage/interfaces/storage-provider.interface.ts` defines the contract. Implement all six methods, then register the provider in `StorageService`.

### Step 1 — Implement the interface

```typescript
// src/storage/providers/gcs.provider.ts
import { IStorageProvider, UploadResult } from '../interfaces/storage-provider.interface';
import { ConfigService } from '@nestjs/config';

export class GcsStorageProvider implements IStorageProvider {
  constructor(private readonly configService: ConfigService) {
    // initialize GCS client using configService.get('GCS_*') env vars
  }

  async ensureBucket(): Promise<void> {
    // verify or create the GCS bucket
  }

  async uploadFile(filePath: string, destination: string, fileName: string): Promise<UploadResult> {
    const objectName = `${destination}/${fileName}`;
    // upload file stream to GCS
    return { objectName, publicUrl: this.getPublicUrl(objectName) };
  }

  async uploadBuffer(buffer: Buffer, destination: string, fileName: string, contentType?: string): Promise<UploadResult> {
    const objectName = `${destination}/${fileName}`;
    // upload buffer to GCS
    return { objectName, publicUrl: this.getPublicUrl(objectName) };
  }

  async deleteFile(objectName: string): Promise<void> {
    // delete from GCS
  }

  getPublicUrl(objectName: string): string {
    const bucket = this.configService.get('GCS_BUCKET');
    return `https://storage.googleapis.com/${bucket}/${objectName}`;
  }

  async getPresignedUrl(objectName: string, expirySeconds = 86400): Promise<string> {
    // generate signed URL
  }
}
```

### Step 2 — Register in StorageService

Open `src/storage/storage.service.ts` and add a `case` to the constructor switch:

```typescript
case 'gcs':
  this.provider = new GcsStorageProvider(configService);
  break;
```

### Step 3 — Document the new env vars

Add the provider-specific variables to your deployment's Kubernetes Secret and update the table in this README.

### Step 4 — Activate

Set `STORAGE_PROVIDER=gcs` in your environment and restart the service.

No other code changes are required. The `UploadService` and `FileProcessingConsumer` use `StorageService` exclusively and are unaware of the underlying provider.
