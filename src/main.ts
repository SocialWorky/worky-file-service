import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Main');
  const app = await NestFactory.create(AppModule);

  await app.listen(parseInt(process.env.APP_PORT) || 3000);
  logger.log(`Application is running on port: ${process.env.APP_PORT}`);
}
bootstrap();
