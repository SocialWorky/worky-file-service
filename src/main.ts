import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Main');
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  await app.listen(parseInt(process.env.APP_PORT) || 3000);
  logger.log(`Application is running on port: ${process.env.APP_PORT}`);
  logger.log(
    `Bull Board está disponible en: ${process.env.BASE_URL}api/queues`,
  );
}
bootstrap();
