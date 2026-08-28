import 'reflect-metadata';
import { env } from '@config/env';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Permite encerrar workers com segurança no SIGTERM.
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
