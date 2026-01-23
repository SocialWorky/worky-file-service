import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { AppService } from './app.service';
import { Observable, of } from 'rxjs';
import { join } from 'path';
import * as fs from 'fs';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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

    const filePath = join(process.cwd(), 'uploads', type, filename);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`File not found: ${type}/${filename}`);
    }

    return of(res.sendFile(filePath));
  }
}
