# Environment Variables — worky-file-service

All sensitive values must be in Kubernetes Secrets — never in ConfigMaps or committed `.env` files.

## Core

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_PORT` | No | `3005` | HTTP listen port |
| `JWT_SECRET` | Yes | — | HS256 secret shared across all services |
| `NODE_ENV` | No | — | Set to `production` for strict CORS and CSP |
| `CORS_ORIGINS` | No | — | Comma-separated allowed origins |
| `BASE_URL` | No | `http://localhost:3005` | Public URL of this service |
| `NAMESPACE` / `KUBERNETES_NAMESPACE` | No | — | Kubernetes namespace for environment auto-detection |

## Redis (Bull Queue)

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_HOST` | Yes | — | Redis hostname |
| `REDIS_PORT` | No | `6379` | Redis port |
| `REDIS_PASSWORD` | No | — | Redis auth password |

## Storage (MinIO — default)

| Variable | Required | Default | Description |
|---|---|---|---|
| `STORAGE_PROVIDER` | No | `minio` | `minio` or `s3` |
| `MINIO_ENDPOINT` | No | `localhost` | MinIO hostname or IP |
| `MINIO_PORT` | No | `9000` | MinIO API port |
| `MINIO_USE_SSL` | No | `false` | `true` when behind HTTPS |
| `MINIO_ACCESS_KEY` | Yes (prod) | `minioadmin` | Access key |
| `MINIO_SECRET_KEY` | Yes (prod) | `minioadmin123` | Secret key |
| `MINIO_BUCKET` | No | `social-network-files` | Target bucket |
| `MINIO_PUBLIC_URL` | No | `http://localhost:9000` | Base URL for public file links |

## Storage (AWS S3 — opt-in)

| Variable | Required | Default | Description |
|---|---|---|---|
| `AWS_REGION` | Yes | `us-east-1` | AWS region |
| `AWS_S3_BUCKET` | Yes | `social-network-files` | S3 bucket name |
| `AWS_ACCESS_KEY_ID` | Yes | — | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | — | AWS secret key |
| `AWS_S3_PUBLIC_URL` | No | auto | Override public URL (CloudFront or custom domain) |

## Inter-Service Communication

| Variable | Required | Description |
|---|---|---|
| `API_BACKEND_URL` | Yes | Base URL of `SocialNetwork-backend-app` |
| `NOTIFICATION_SERVICE_URL` | Yes | Base URL of `worky-connect-service` |
| `API_MESSAGES_SERVICE_URL` | Yes | Base URL of `worky-message-service` |

## Local Development Example

```env
APP_PORT=3005
JWT_SECRET=dev-secret
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
