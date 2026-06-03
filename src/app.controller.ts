import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { Observable, of } from 'rxjs';
import { join, resolve, sep } from 'path';
import * as fs from 'fs';

@Controller()
export class AppController {
  // Persistent dir used by the local storage provider; falls back to the multer temp dir.
  private readonly storageDir: string;
  private readonly uploadsDir = resolve(process.cwd(), 'uploads');

  constructor(
    private readonly appService: AppService,
    private readonly configService: ConfigService,
  ) {
    this.storageDir = resolve(
      this.configService.get<string>('LOCAL_STORAGE_DIR') || join(process.cwd(), 'storage'),
    );
  }

  @Get(':type/:filename')
  getFile(
    @Param('type') type: string,
    @Param('filename') filename: string,
    @Res() res,
  ): Observable<Object> {
    // Skip reserved paths - let other controllers handle them
    // This must be checked FIRST before any processing
    const reservedPaths = ['health', 'upload', 'api'];
    if (reservedPaths.includes(type)) {
      // Return 404 to let NestJS routing continue to other controllers
      // This prevents the catch-all from intercepting reserved routes
      throw new NotFoundException(`Route reserved: ${type}`);
    }

    const filePath = this.resolveServablePath(type, filename);
    if (!filePath) {
      throw new NotFoundException(`File not found: ${type}/${filename}`);
    }

    return of(res.sendFile(filePath));
  }

  private resolveServablePath(type: string, filename: string): string | null {
    for (const root of [this.storageDir, this.uploadsDir]) {
      const candidate = resolve(root, type, filename);
      // Guard against path traversal via crafted type/filename params.
      if (candidate !== root && !candidate.startsWith(root + sep)) continue;
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }
}
