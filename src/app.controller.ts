import { Controller, Get, Param, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { Observable, of } from 'rxjs';
import { join } from 'path';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get(':type/:filename')
  getFile(
    @Param('type') type,
    @Param('filename') filename,
    @Res() res,
    // eslint-disable-next-line @typescript-eslint/ban-types
  ): Observable<Object> {
    return of(
      res.sendFile(join(process.cwd(), 'uploads/' + type + '/' + filename)),
    );
  }
}
