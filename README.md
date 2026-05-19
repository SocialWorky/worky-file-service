# worky-file-service

> Centralized media upload and processing service. Every image and video in the platform flows through here — validated by magic bytes, queued via Bull/Redis, optimized with Sharp/FFmpeg, and stored in MinIO or S3.

## Stack

| | |
|---|---|
| Runtime | Node.js 22 |
| Framework | NestJS 10 |
| Queue | Bull + Redis (3 jobs/s, 3 retries, exponential backoff) |
| Images | Sharp — 800px compressed + 200px thumbnail, EXIF auto-rotation |
| Videos | FFmpeg — 720p H.264 (CRF 23) + JPEG thumbnail at 1s |
| Storage | MinIO (default) / AWS S3 (opt-in) |
| Port | 3005 |

## Quick Start

```bash
npm install
npm run start:dev
```

Requires Redis and MinIO (or S3) running. See [docs/environment-variables.md](./docs/environment-variables.md).

## Upload Endpoint

```
POST /upload
Authorization: Bearer <JWT>
Content-Type: multipart/form-data
Limits: 10 files · 100 MB each
```

| Field | Required | Description |
|---|---|---|
| `files` | Yes | One or more files |
| `userId` | Yes | Uploading user ID |
| `destination` | Yes | Storage subdirectory (e.g. `posts`, `profileImg`) |
| `type` | No | Upload context — see types below |
| `idReference` | No | Entity UUID the file attaches to |

**Type values:** `profileImg` · `post` · `comment` · `postProfile` · `image-view` · `message` · `emoji` · `all`

> `profileImg` is processed **synchronously** (waits up to 30s). All other types return `201` immediately and process in the background.

## Queue Monitor

Bull Board UI: `http://localhost:3005/api/queues` (JWT-protected)

## Health

`GET /health` · `GET /health/live` · `GET /health/ready`

## Docs

- [Processing Pipeline](./docs/processing-pipeline.md) — image/video pipeline, queue config, storage providers, adding new providers
- [Environment Variables](./docs/environment-variables.md) — all env vars with defaults
