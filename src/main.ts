import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Main');
  const app = await NestFactory.create(AppModule);

  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : [];

  // In development, allow localhost if no CORS_ORIGINS configured
  const isDevelopment = process.env.NODE_ENV !== 'production';

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) {
        callback(null, true);
        return;
      }

      // In development with no CORS_ORIGINS, allow localhost
      if (isDevelopment && corsOrigins.length === 0 && origin.includes('localhost')) {
        callback(null, true);
        return;
      }

      if (corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked request from: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Note: No global prefix for file-service since it serves static files at root level
  // Routes: /:type/:filename for files, /upload for uploads, /health for health checks

  const port = parseInt(process.env.APP_PORT) || 3005;
  
  try {
    await app.listen(port, '0.0.0.0');
    logger.log(`Application is running on port: ${port}`);
    logger.log(`Health check available at: http://0.0.0.0:${port}/health`);
    logger.log(`Liveness probe: http://0.0.0.0:${port}/health/live`);
    logger.log(`Readiness probe: http://0.0.0.0:${port}/health/ready`);
    logger.log(`Bull Board is available at: ${process.env.BASE_URL || 'http://localhost:' + port}/api/queues`);
  } catch (error) {
    logger.error(`Failed to start application on port ${port}:`, error);
    throw error;
  }
}
bootstrap();
