import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import * as path from 'path';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);
  private readonly uploadsRoot = path.resolve(
    path.join(__dirname, '..', 'uploads'),
  );

  @Cron(CronExpression.EVERY_HOUR)
  async purgeStaleUploads(): Promise<void> {
    const cutoff = Date.now() - MAX_AGE_MS;
    let removed = 0;
    try {
      removed = await this.purgeDir(this.uploadsRoot, cutoff);
    } catch (error) {
      this.logger.error(`Cleanup failed: ${error.message}`);
      return;
    }
    if (removed > 0) {
      this.logger.log(`Purged ${removed} stale upload file(s) older than 24h`);
    }
  }

  private async purgeDir(dir: string, cutoff: number): Promise<number> {
    let removed = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        removed += await this.purgeDir(fullPath, cutoff);
        continue;
      }
      const stat = await fs.stat(fullPath).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) {
        await fs.unlink(fullPath).catch(() => undefined);
        removed += 1;
      }
    }
    return removed;
  }
}
