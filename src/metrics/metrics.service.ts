import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry: Registry;
  private readonly processedCounter: Counter;
  private readonly durationHistogram: Histogram;
  private readonly dedupCounter: Counter;
  private readonly inputSizeHistogram: Histogram;

  constructor() {
    this.registry = new Registry();

    this.processedCounter = new Counter({
      name: 'file_processing_total',
      help: 'Total number of files processed',
      labelNames: ['status', 'type'],
      registers: [this.registry],
    });

    this.durationHistogram = new Histogram({
      name: 'file_processing_duration_ms',
      help: 'File processing duration in milliseconds',
      labelNames: ['type'],
      buckets: [100, 500, 1000, 3000, 10000, 30000, 60000, 300000],
      registers: [this.registry],
    });

    this.dedupCounter = new Counter({
      name: 'file_deduplication_total',
      help: 'Total number of deduplicated file uploads',
      registers: [this.registry],
    });

    this.inputSizeHistogram = new Histogram({
      name: 'file_input_size_bytes',
      help: 'Input file size in bytes',
      labelNames: ['type'],
      buckets: [10_000, 100_000, 1_000_000, 5_000_000, 20_000_000, 100_000_000],
      registers: [this.registry],
    });
  }

  recordSuccess(type: string, durationMs: number, inputBytes: number, deduplicated: boolean): void {
    this.processedCounter.inc({ status: 'success', type });
    this.durationHistogram.observe({ type }, durationMs);
    this.inputSizeHistogram.observe({ type }, inputBytes);
    if (deduplicated) {
      this.dedupCounter.inc();
    }
  }

  recordFailure(type: string, durationMs: number): void {
    this.processedCounter.inc({ status: 'failed', type });
    this.durationHistogram.observe({ type }, durationMs);
  }

  getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
