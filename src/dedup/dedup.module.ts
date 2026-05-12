import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { DedupService } from './dedup.service';

@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () =>
        new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
          password: process.env.REDIS_PASSWORD || undefined,
        }),
    },
    DedupService,
  ],
  exports: [DedupService],
})
export class DedupModule {}
