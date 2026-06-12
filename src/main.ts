import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import * as jwt from 'jsonwebtoken';
import { AppModule } from './app.module';
import { StorageService } from './storage/storage.service';

function bullBoardAuthMiddleware(req: any, res: any, next: () => void) {
  try {
    const authHeader: string | undefined = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as {
      role?: string;
    };
    if (payload.role !== 'admin') {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ message: 'Unauthorized' });
  }
}

async function bootstrap() {
  const logger = new Logger('Main');
  const app = await NestFactory.create(AppModule);

  // Health endpoints registered as Express middleware before NestJS routes to avoid
  // being swallowed by the catch-all /:type/:filename file route.
  const expressApp = app.getHttpAdapter().getInstance();
  const storageService = app.get(StorageService);

  // Protect Bull Board — queue internals must not be publicly reachable
  expressApp.use('/api/queues', bullBoardAuthMiddleware);

  expressApp.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Liveness must stay independent of MinIO: the process is alive even if storage is down,
  // so Kubernetes should not restart the pod over a transient MinIO outage.
  expressApp.get('/health/live', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Readiness reflects MinIO/bucket reachability so Kubernetes pulls the pod out of
  // rotation while storage is unreachable, instead of serving requests that will fail.
  expressApp.get('/health/ready', async (req, res) => {
    try {
      const storage = await storageService.checkHealth();
      const status = storage.healthy ? 200 : 503;
      res.status(status).json({
        status: storage.healthy ? 'ok' : 'unhealthy',
        storage,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        storage: { healthy: false, detail: error?.message || 'storage check failed' },
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').filter(o => o.trim())
    : [];

  const isDevelopment = process.env.NODE_ENV !== 'production';
  const envName = process.env.ENVIRONMENT || process.env.ENV || '';
  const appUrl = process.env.APP_URL || process.env.BASE_URL || '';
  const namespace = process.env.NAMESPACE || process.env.KUBERNETES_NAMESPACE || '';
  
  const isDevEnvironment = isDevelopment ||
                           envName.toLowerCase().includes('dev') || 
                           envName.toLowerCase().includes('development') ||
                           envName.toLowerCase().includes('staging') ||
                           envName.toLowerCase().includes('test') ||
                           appUrl.toLowerCase().includes('dev') ||
                           appUrl.toLowerCase().includes('staging') ||
                           namespace.toLowerCase().includes('dev') ||
                           namespace.toLowerCase().includes('staging') ||
                           corsOrigins.length === 0;

  const allowedOrigins = corsOrigins.length > 0
    ? [...corsOrigins, ...(isDevEnvironment ? ['http://localhost:4200', 'http://localhost:4201'] : [])]
    : (isDevEnvironment ? ['http://localhost:4200', 'http://localhost:4201'] : []);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (isDevEnvironment && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        callback(null, true);
        return;
      }
      
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        if (corsOrigins.length === 0) {
          callback(null, true);
          return;
        }
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked request from: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'cache-control',
      'x-request-timeout',
      'x-requested-with',
      'accept',
      'origin',
      'access-control-request-method',
      'access-control-request-headers'
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  const port = parseInt(process.env.APP_PORT || '3005', 10);
  
  try {
    await app.listen(port, '0.0.0.0');
    logger.log(`Application is running on port: ${port}`);
    logger.log(`Health check available at: http://0.0.0.0:${port}/health`);
    logger.log(`Liveness probe: http://0.0.0.0:${port}/health/live`);
    logger.log(`Readiness probe: http://0.0.0.0:${port}/health/ready`);
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    logger.log(`Bull Board is available at: ${normalizedBaseUrl}/api/queues`);
  } catch (error) {
    logger.error(`Failed to start application on port ${port}:`, error);
    throw error;
  }
}
bootstrap();
