import { Injectable, Inject } from '@nestjs/common';
import * as fs from 'fs';
import * as crypto from 'crypto';
import Redis from 'ioredis';

const DEDUP_TTL_SECONDS = 2_592_000; // 30 days

@Injectable()
export class DedupService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  computeHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async getCached(hash: string, destination: string): Promise<any | null> {
    const raw = await this.redis.get(`dedup:${hash}:${destination}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async setCached(hash: string, destination: string, result: any): Promise<void> {
    await this.redis.set(
      `dedup:${hash}:${destination}`,
      JSON.stringify(result),
      'EX',
      DEDUP_TTL_SECONDS,
    );
  }
}
