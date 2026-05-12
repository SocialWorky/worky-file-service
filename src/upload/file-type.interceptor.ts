import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import * as fs from 'fs';

interface MagicSignature {
  bytes: number[];
  offset?: number;
  mimeType: string;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  { bytes: [0xff, 0xd8, 0xff], mimeType: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mimeType: 'image/png' },
  { bytes: [0x47, 0x49, 0x46, 0x38], mimeType: 'image/gif' },
  { bytes: [0x42, 0x4d], mimeType: 'image/bmp' },
  { bytes: [0x49, 0x49, 0x2a, 0x00], mimeType: 'image/tiff' },
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], mimeType: 'image/tiff' },
  { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, mimeType: 'image/webp' },
  { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, mimeType: 'video/avi' },
  { bytes: [0x00, 0x00, 0x01, 0xb3], mimeType: 'video/mpeg' },
  { bytes: [0x00, 0x00, 0x01, 0xba], mimeType: 'video/mpeg' },
];

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/webp',
  'video/mp4',
  'video/mpeg',
  'video/quicktime',
  'video/avi',
]);

function detectMimeFromBytes(buf: Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buf.length < offset + sig.bytes.length) continue;
    const matches = sig.bytes.every((b, i) => buf[offset + i] === b);
    if (matches) {
      if (sig.mimeType === 'image/webp') {
        if (buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
          return 'image/webp';
        }
        if (buf.length >= 12 && buf[8] === 0x41 && buf[9] === 0x56 && buf[10] === 0x49 && buf[11] === 0x20) {
          return 'video/avi';
        }
        continue;
      }
      return sig.mimeType;
    }
  }
  if (buf.length >= 12) {
    const ftypOffset = 4;
    if (
      buf[ftypOffset] === 0x66 && buf[ftypOffset + 1] === 0x74 &&
      buf[ftypOffset + 2] === 0x79 && buf[ftypOffset + 3] === 0x70
    ) {
      return 'video/mp4';
    }
  }
  return null;
}

function deleteFileSafe(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // best-effort cleanup — already logged upstream if needed
  }
}

@Injectable()
export class FileTypeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const files = request.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      throw new BadRequestException('No files have been uploaded.');
    }

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        // Delete ALL already-written temp files before rejecting
        files.forEach(f => deleteFileSafe(f.path));
        throw new BadRequestException(`File type not allowed: ${file.originalname}`);
      }

      try {
        let buf: Buffer;
        if (file.path) {
          const fd = fs.openSync(file.path, 'r');
          buf = Buffer.alloc(16);
          fs.readSync(fd, buf, 0, 16, 0);
          fs.closeSync(fd);
        } else if (file.buffer && file.buffer.length > 0) {
          buf = file.buffer.slice(0, 16);
        } else {
          files.forEach(f => deleteFileSafe(f.path));
          throw new BadRequestException(`Cannot read file content: ${file.originalname}`);
        }

        const detectedMime = detectMimeFromBytes(buf);
        if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
          files.forEach(f => deleteFileSafe(f.path));
          throw new BadRequestException(`File content does not match declared type: ${file.originalname}`);
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        files.forEach(f => deleteFileSafe(f.path));
        throw new BadRequestException(`Could not validate file: ${file.originalname}`);
      }
    }

    return next.handle();
  }
}
