import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Main');
  const app = await NestFactory.create(AppModule);

  // CRITICAL: Register health endpoints as Express middleware BEFORE NestJS routes
  // This ensures health checks are handled before the catch-all file route (:type/:filename)
  const expressApp = app.getHttpAdapter().getInstance();

  expressApp.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  expressApp.get('/health/live', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  expressApp.get('/health/ready', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').filter(o => o.trim())
    : [];

  // Check if we're in a dev/staging environment
  // This allows localhost access when running in dev/staging environments
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const envName = process.env.ENVIRONMENT || process.env.ENV || '';
  const appUrl = process.env.APP_URL || process.env.BASE_URL || '';
  const namespace = process.env.NAMESPACE || process.env.KUBERNETES_NAMESPACE || '';
  
  // Consider it a dev environment if:
  // 1. NODE_ENV is not production
  // 2. ENVIRONMENT contains dev/staging/test
  // 3. APP_URL/BASE_URL contains "dev" or "staging"
  // 4. NAMESPACE contains "dev" or "staging"
  // 5. If CORS_ORIGINS is empty, assume it's dev (more permissive)
  const isDevEnvironment = isDevelopment || 
                           envName.toLowerCase().includes('dev') || 
                           envName.toLowerCase().includes('development') ||
                           envName.toLowerCase().includes('staging') ||
                           envName.toLowerCase().includes('test') ||
                           appUrl.toLowerCase().includes('dev') ||
                           appUrl.toLowerCase().includes('staging') ||
                           namespace.toLowerCase().includes('dev') ||
                           namespace.toLowerCase().includes('staging') ||
                           corsOrigins.length === 0; // If no CORS_ORIGINS configured, be permissive
  
  // Build allowed origins list - always include localhost for dev environments
  const allowedOrigins = corsOrigins.length > 0 
    ? [...corsOrigins, ...(isDevEnvironment ? ['http://localhost:4200', 'http://localhost:4201'] : [])]
    : (isDevEnvironment ? ['http://localhost:4200', 'http://localhost:4201'] : []);

  logger.log(`CORS configuration: isDevEnvironment=${isDevEnvironment}, envName=${envName}, appUrl=${appUrl}, namespace=${namespace}, corsOrigins=${corsOrigins.length}, allowedOrigins=${allowedOrigins.join(', ')}`);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) {
        callback(null, true);
        return;
      }

      // In dev/staging environments, ALWAYS allow localhost origins for local development
      // This works even if CORS_ORIGINS is configured - it's a safety net for dev environments
      if (isDevEnvironment && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        logger.log(`CORS: Allowing localhost origin ${origin} in dev environment`);
        callback(null, true);
        return;
      }
      
      // Also allow localhost if the request host contains "dev" or "staging"
      // This catches cases where the service is behind a proxy/ingress
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        // Check if we can detect dev environment from request context
        // For now, be permissive if no CORS_ORIGINS is configured
        if (corsOrigins.length === 0) {
          logger.log(`CORS: Allowing localhost origin ${origin} (no CORS_ORIGINS configured)`);
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

  // Note: No global prefix for file-service since it serves static files at root level
  // Routes: /:type/:filename for files, /upload for uploads, /health for health checks

  const port = parseInt(process.env.APP_PORT || '3005', 10);
  
  try {
    await app.listen(port, '0.0.0.0');
    logger.log(`Application is running on port: ${port}`);
    logger.log(`Health check available at: http://0.0.0.0:${port}/health`);
    logger.log(`Liveness probe: http://0.0.0.0:${port}/health/live`);
    logger.log(`Readiness probe: http://0.0.0.0:${port}/health/ready`);
    
    // Normalize BASE_URL to remove trailing slash before concatenating
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    logger.log(`Bull Board is available at: ${normalizedBaseUrl}/api/queues`);
  } catch (error) {
    logger.error(`Failed to start application on port ${port}:`, error);
    throw error;
  }
}
bootstrap();
