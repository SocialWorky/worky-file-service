import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Main');
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || '*') {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: false,
  });

  await app.listen(parseInt(process.env.APP_PORT) || 3000);
  logger.log(`Application is running on port: ${process.env.APP_PORT}`);
  logger.log(
    `Bull Board está disponible en: ${process.env.BASE_URL}api/queues`,
  );
}
bootstrap();
